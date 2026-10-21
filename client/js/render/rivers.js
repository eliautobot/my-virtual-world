// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Rivers and waterfalls (WP4.18, wp4-world-spec.md §6.1): each river of the island (shared/terrain.js Island.rivers)
// as a ribbon of water down its carved channel, its ripples flowing downstream (faster where it is steep) and whitening
// on rapids. Its waterfalls (2026-10-03, a diagram and a photo: "waterfalls fall, not run down along the mountain"):
// at each drop (shared/terrain.js _stairs) the river runs smooth and glassy over a ledge of hard cap rock and falls
// free — a curtain of white water thrown out from the lip, streaming down in columns and pulses, spreading and breaking
// into spray as it falls — into its plunge pool (a small lake, drawn with the lakes), where it churns the water white
// and raises a cloud of mist. One draw call each for all rivers, all curtains, all pools' white water, all ledges and
// all mist.
import * as THREE from 'three';
import { GU } from './scene.js';
import { lakeShore } from '/shared/terrain.js';

/** m the drawn water reaches past a river's channel: over its shallow shelf to its shore (shared/terrain.js). */
const RIBBON_PAST = 4.5;
const G = 9.81;
const fract = v => v - Math.floor(v);

const NOISE_GLSL = /* glsl */`
float wfH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wfN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(wfH(i), wfH(i + vec2(1.0, 0.0)), f.x), mix(wfH(i + vec2(0.0, 1.0)), wfH(i + vec2(1.0, 1.0)), f.x), f.y); }`;

export class RiversLayer {
  constructor(island, normalMap) {
    this.group = new THREE.Group(); this.group.name = 'rivers';
    const tex = this.tex = normalMap.clone(); tex.needsUpdate = true; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const pos = [], col = [], uv = [], idx = [], riv = [];
    const pools = (island.lakes || []).filter(k => k.pool), poolOf = id => pools.find(k => k.id === id);
    // (inside a plunge pool the pool's own water is drawn: the river's ribbon stops at its edge)
    const inPool = (x, z) => pools.some(k => (x - k.x) ** 2 + (z - k.z) ** 2 < (k.r * 0.92) ** 2);
    const drops = [];
    for (const R of island.rivers) {
      const lips = new Set((R.drops || []).filter(d => d.kind !== 'cascade').map(d => d.i));   // (a cascade's water runs on down its steps)
      for (const d of R.drops || []) drops.push(d);
      // densify the course (every ~4 m) so the ribbon follows its bends smoothly; it breaks at each waterfall's lip
      const P = [];
      // a river that falls straight out of its tarn (its first point a lip, a few metres past the tarn's edge): its water
      // runs from inside the tarn to the lip (2026-10-03: bare rock showed between the lake and the falling water)
      const src = lips.has(0) && (island.lakes || []).find(k => !k.pool && Math.hypot(k.x - R.pts[0].x, k.z - R.pts[0].z) < k.r * 1.6);
      if (src) {
        const a = R.pts[0], dx = a.x - src.x, dz = a.z - src.z, l = Math.hypot(dx, dz) || 1, from = src.r * 0.8, n = Math.max(2, Math.round((l - from) / 4));
        for (let i = 0; i < n; i++) { const t = from + (l - from) * (i / n); P.push({ x: src.x + dx / l * t, z: src.z + dz / l * t, y: a.y, w: a.w * (1.6 - 0.6 * i / n), s: a.s - (l - t), slope: 0 }); }
      }
      for (let k = 0; k + 1 < R.pts.length; k++) {
        const a = R.pts[k], b = R.pts[k + 1];
        if (lips.has(k)) { P.push({ ...a, slope: 0, brk: true }); continue; }
        const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / 4));
        const slope = (a.y - b.y) / Math.max(1, Math.hypot(b.x - a.x, b.z - a.z));   // how steeply the water runs here
        for (let i = 0; i < n; i++) { const t = i / n; P.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, s: a.s + (b.s - a.s) * t, slope }); }
      }
      P.push({ ...R.pts.at(-1), slope: 0 });
      for (const q of P) q.hide = inPool(q.x, q.z);
      const base = pos.length / 3;
      P.forEach((q, i) => {
        // the water reaches a few metres past its channel (2026-10-03: the channel's steep sides showed as a dark
        // saw-tooth fringe on the coarser ground): where the bank rises above it, the bank hides it — the shore is where
        // the ground meets the water
        const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l, hw = q.w / 2 + RIBBON_PAST;
        const white = Math.min(1, Math.max(0, (q.slope - 0.12) * 4));   // foam on rapids only (the falls are curtains)
        // five across: banks, shallows, the deep middle (each vertex knows where across it lies, for depth and foam)
        for (const f of [0, 0.22, 0.5, 0.78, 1]) {
          const o = (f * 2 - 1) * hw;
          pos.push(q.x + nx * o, q.y + 0.04, q.z + nz * o);
          col.push(white, white, white);
          uv.push(f * q.w / 6, q.s / 6);
          riv.push(o / (q.w / 2), q.w, Math.min(1, Math.max(0, q.slope * 3)));   // across: −1..1 over the water, beyond on the banks
        }
        if (i + 1 < P.length && !q.brk && !q.hide && !P[i + 1].hide) { const o = base + i * 5; for (let k = 0; k < 4; k++) idx.push(o + k, o + k + 1, o + k + 5, o + k + 1, o + k + 6, o + k + 5); }   // facing up
      });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aRiver', new THREE.Float32BufferAttribute(riv, 3));
    g.setIndex(idx); g.computeVertexNormals();
    // Water with structure (the design review 2026-10-03): clear and pale over the gravel of the shallows, deep blue-green down
    // the middle, foam streaks drawn out downstream (faster and whiter on rapids and falls), a lace of foam along the
    // banks, the light glinting on the ripples.
    // 2026-10-03 ("smooth ... cozy"): clear bright water, soft ripples, white water only where it runs fast, and a
    // clean soft line of foam where it meets the bank — not streaks all over
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0.02, transparent: true, normalMap: tex, normalScale: new THREE.Vector2(0.3, 0.3), depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0.6 });
    this.mat.onBeforeCompile = sh => {
      sh.uniforms.uRTime = GU.uTime;
      sh.vertexShader = 'attribute vec3 aRiver;\nvarying vec3 vRiver;\nvarying vec2 vRUv;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vRiver = aRiver; vRUv = uv;');
      sh.fragmentShader = `uniform float uRTime;\nvarying vec3 vRiver;\nvarying vec2 vRUv;
float rH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float rN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(rH(i), rH(i + vec2(1.0, 0.0)), f.x), mix(rH(i + vec2(0.0, 1.0)), rH(i + vec2(1.0, 1.0)), f.x), f.y); }
` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float across = clamp(vRiver.x * 0.5 + 0.5, 0.0, 1.0), mid = 1.0 - min(1.0, abs(vRiver.x)), rough = vRiver.z, white = vColor.r;
        float deep = smoothstep(0.1, 0.85, mid);
        vec3 water = mix(vec3(0.16, 0.48, 0.44), vec3(0.04, 0.24, 0.32), deep);
        // white water on rapids and falls only, stretched along the flow and carried downstream; elsewhere smooth
        float along = vRUv.y * 6.0, x = across * vRiver.y;
        float flow = uRTime * (1.2 + 5.0 * rough), px = length(fwidth(vec2(x, along)));
        float streak = rN(vec2(x * 1.3, (along - flow) * 0.12)) * 0.6 + rN(vec2(x * 3.1, (along - flow * 1.3) * 0.35)) * 0.4;
        streak = mix(0.5, streak, smoothstep(2.0, 0.5, px));
        float foam = smoothstep(0.62, 0.8, streak) * smoothstep(0.25, 0.7, rough);
        // a soft line of foam at the banks, gently lapping
        foam = clamp(max(foam, white * (0.55 + 0.45 * streak)), 0.0, 1.0);
        diffuseColor.rgb = mix(water, vec3(0.92, 0.96, 0.97), foam);
        // clear and thin toward its edges, gone at the ribbon's rim: where the ground meets it, the shore is soft
        float outer = 1.0 + ${(2 * 4.5).toFixed(1)} / max(vRiver.y, 1.0), ax = abs(vRiver.x);
        diffuseColor.a = (mix(0.5, 0.88, deep) + foam * 0.4) * (1.0 - smoothstep(0.75, outer, ax)) + 0.18 * (1.0 - smoothstep(1.0, outer, ax)) * smoothstep(0.75, 1.0, ax);`);
    };
    this.mat.customProgramCacheKey = () => 'river-water';
    this.water = new THREE.Mesh(g, this.mat); this.water.renderOrder = 1; this.water.receiveShadow = true;
    this.group.add(this.water);
    this.mats = [this.mat]; this.geos = [g];
    if (drops.length) this.buildFalls(island, drops, poolOf);
  }

  /**
   * The waterfalls (shared/terrain.js _stairs: each drop's style and dice). A fall: a ledge of hard cap rock standing out
   * over the undercut cliff, the river running out over it and falling free from its front edge in the drop's own style —
   * one curtain thrown out (plunge), close down the rock (horsetail) or wide and thin (veil), two parted by a buttress of
   * rock (twin), or two tiers off a shelf (tiered) — in front of a curved wall of layered rock round its pool's back;
   * where it lands, churned white water, a skirt of spray bursting up, droplets thrown out and a cloud of mist. A cascade:
   * the river's own white water down its rock steps (the ribbon), a lip of rock at each step, spray at each foot, the
   * boulders round it from the terrain worker. All built once; the motion is in the shaders.
   */
  buildFalls(island, drops, poolOf) {
    const B = {
      cp: [], cf: [], cb: [], ci: [],          // curtains: position, aFall (across, t, fall time, width), aFallB (opacity, seed)
      fp: [], ff: [], fi: [],                  // white water on the pools: position, aFoam (r 0..1, x, z m from its middle, seed)
      lp: [], lc: [], li: [],                  // ledges and shelves: position, colour
      wp: [], wc: [], wi: [],                  // carved rock walls and buttresses: position, colour
      sp: [], sa: [], si: [],                  // spray skirts: position, aSpray (angle, height share, height, seed)
      dp: [],                                  // droplets: base x, y, z, seed; F, angle, reach, -
      mist: [],
    };
    const rivers = island.rivers;
    drops.forEach((d, n) => {
      const pool = poolOf(d.pool);
      if (d.kind === 'cascade') return this.cascade(B, d, n, pool, rivers.find(R => R.drops?.includes(d)), island);
      const W = d.w + 0.6, ov = d.ov, y0 = d.y + 0.04, vLip = d.v;
      // where the water leaves the rock, and each curtain's share of the width (twin falls: two, the buttress between)
      const strips = [];
      if (d.style === 'twin') {
        const cut = -W / 2 + W * d.split;
        strips.push([-W / 2, cut - d.gap / 2], [cut + d.gap / 2, W / 2]);
      } else strips.push([-W / 2, W / 2]);
      const opac = d.style === 'veil' ? 0.72 : d.style === 'horsetail' ? 1 : 0.92;
      let landX = 0;
      if (d.style === 'tiered') {
        // two tiers: the upper lands on a shelf of rock part-way down and runs out over its edge, the lower falls on
        const Ht = d.F * d.tier, T1 = Math.sqrt(2 * Ht / G), x1 = ov + vLip * T1, xe = x1 + d.tierOut, v2 = 1.1;
        this.strip(B, d, 0, ov, y0, -W / 2, W / 2, Ht, vLip, opac, n * 3);
        this.shelf(B, d, -1.5, xe, d.y - Ht, W / 2 + 2 + Ht * 0.1);
        this.foamDisc(B, d, x1, 0, d.y - Ht + 0.06, Math.min(xe - x1 + 1.5, 2 + W * 0.3), n + 0.5);
        this.splashAt(B, d, x1, 0, d.y - Ht, W * 0.6, Ht * 0.5, n + 0.5);
        const W2 = W + Ht * 0.12;
        this.strip(B, d, x1, xe, d.y - Ht + 0.04, -W2 / 2, W2 / 2, d.F - Ht, v2, opac, n * 3 + 1);
        landX = xe + v2 * Math.sqrt(2 * (d.F - Ht) / G);
      } else {
        strips.forEach(([u0, u1], k) => this.strip(B, d, 0, ov, y0, u0, u1, d.F, vLip, opac, n * 3 + k));
        landX = ov + vLip * Math.sqrt(2 * d.F / G);
      }
      // the cap rock over the undercut cliff, the pool's rock wall behind the water, a buttress between twin falls
      this.ledge(B, d, island, W, ov, d.thick, d.style === 'twin' ? [-W / 2 + W * d.split, d.gap] : null);
      if (pool) this.wall(B, d, pool, island, W, ov);
      if (d.style === 'twin') this.buttress(B, d, -W / 2 + W * d.split, d.gap, ov);
      // where it lands
      const Wl = W + d.F * 0.12, Rf = Math.max(2.5, Math.min(pool ? pool.r * 0.8 : 8, 2 + Wl * 0.45 + d.F * 0.06));
      this.foamDisc(B, d, landX, 0, d.y - d.F + 0.05, Rf, n);
      this.splashAt(B, d, landX, 0, d.y - d.F, Wl, d.F, n);
    });
    this.finishFalls(B);
  }

  /** A point at (along: m downstream of the lip, up: m, side: m across, left positive) of drop d, in the world. */
  at(d, along, y, side) { return [d.x + d.dx * along - d.dz * side, y, d.z + d.dz * along + d.dx * side]; }

  /**
   * One curtain: from xFlat to x0 the water runs smooth over the rock's edge (y0), then falls F m on its arc at v m/s,
   * between u0 and u1 across, spreading as it falls, bulging a little in its middle; a little past the water below.
   */
  strip(B, d, xFlat, x0, y0, u0, u1, F, v, opac, seed) {
    const T = Math.sqrt(2 * F / G), NC = Math.max(4, Math.round((u1 - u0) / 1.2)), NR = 30, b0 = B.cp.length / 3, W0 = u1 - u0, mid = (u0 + u1) / 2;
    const rows = [];
    for (const f of [0, 0.5]) rows.push({ x: xFlat + (x0 - xFlat) * f, y: y0, t: 0, Wd: W0 });
    for (let r = 0; r <= NR; r++) { const t = (r / NR) * 1.03, tt = t * T; rows.push({ x: x0 + v * tt, y: y0 - 0.5 * G * tt * tt, t: Math.min(1, t), Wd: W0 + F * 0.12 * t }); }
    rows.forEach(rw => {
      for (let c = 0; c <= NC; c++) {
        const u = c / NC - 0.5, bulge = (1 - 4 * u * u) * 0.4 * Math.sqrt(rw.t);
        B.cp.push(...this.at(d, rw.x + bulge, rw.y, mid + u * rw.Wd)); B.cf.push(c / NC, rw.t, T, rw.Wd); B.cb.push(opac, seed, 0, 0);
      }
    });
    for (let r = 0; r + 1 < rows.length; r++) for (let c = 0; c < NC; c++) { const a = b0 + r * (NC + 1) + c; B.ci.push(a, a + NC + 1, a + 1, a + 1, a + NC + 1, a + NC + 2); }
  }

  /** Churned white water spreading over the water where a fall lands (stretched downstream by the current). */
  foamDisc(B, d, along, side, y, Rf, seed) {
    const NRf = 8, NAf = 40, f0 = B.fp.length / 3, [ix, , iz] = this.at(d, along, y, side), sx = -d.dz, sz = d.dx;
    B.fp.push(ix, y, iz); B.ff.push(0, 0, 0, seed);
    for (let r = 1; r <= NRf; r++) for (let a = 0; a < NAf; a++) {
      const an = a / NAf * Math.PI * 2, rr = r / NRf, ex = Math.cos(an) * Rf * rr, ez = Math.sin(an) * Rf * rr * 0.85, fwd = Math.max(0, ex) * 0.5;
      B.fp.push(ix + d.dx * (ex + fwd) + sx * ez, y, iz + d.dz * (ex + fwd) + sz * ez); B.ff.push(rr, ex, ez, seed);   // (its place in metres, not its angle: an angle wraps, and the wedge where it did drew a streak)
    }
    const at = (r, a) => (r === 0 ? f0 : f0 + 1 + (r - 1) * NAf + (a % NAf));
    for (let a = 0; a < NAf; a++) B.fi.push(at(0, 0), at(1, a + 1), at(1, a));
    for (let r = 1; r < NRf; r++) for (let a = 0; a < NAf; a++) B.fi.push(at(r, a), at(r, a + 1), at(r + 1, a + 1), at(r, a), at(r + 1, a + 1), at(r + 1, a));
  }

  /**
   * Where falling water strikes water (2026-10-03: "some kind of mist/splash effect at the bottom"): a skirt of spray
   * bursting up round it, droplets thrown out on their arcs, and mist billowing up and drifting downstream — all bigger
   * for a taller, wider fall.
   */
  splashAt(B, d, along, side, y, Wl, F, seed) {
    const [ix, , iz] = this.at(d, along, y, side), Rb = 0.8 + Wl * 0.32, H = 1.5 + F * 0.075, Rt = Rb + 1.5 + F * 0.05, NA = 28, NR = 5, b0 = B.sp.length / 3;
    for (let r = 0; r <= NR; r++) for (let a = 0; a <= NA; a++) {
      const f = r / NR, an = a / NA * Math.PI * 2, rr = Rb + (Rt - Rb) * Math.sqrt(f), ex = Math.cos(an) * rr, ez = Math.sin(an) * rr * 0.8;
      B.sp.push(ix + d.dx * ex - d.dz * ez, y + H * f, iz + d.dz * ex + d.dx * ez); B.sa.push(an, f, H, seed);
    }
    for (let r = 0; r < NR; r++) for (let a = 0; a < NA; a++) { const p = b0 + r * (NA + 1) + a; B.si.push(p, p + 1, p + NA + 1, p + 1, p + NA + 2, p + NA + 1); }
    const nd = Math.round(24 + F * 0.9 + Wl * 2);
    for (let k = 0; k < nd; k++) { const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * Rb; B.dp.push(ix + Math.cos(a) * rr, y, iz + Math.sin(a) * rr, Math.random(), F, Math.random() * Math.PI * 2, Math.random(), 0); }
    const nm = Math.round(20 + F * 1.4 + Wl * 1.5);
    for (let m = 0; m < nm; m++) { const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * Rb * 1.2; B.mist.push(ix + Math.cos(a) * rr, y, iz + Math.sin(a) * rr, Math.random(), F, d.dx, d.dz, Rb * 1.5); }
  }

  /**
   * A cascade (a smaller drop, shared/terrain.js): the river's white water down its rock steps is the ribbon; here a lip
   * of rock across the water at the head of each step, spray where each step's water lands, white water and a little
   * mist in its basin.
   */
  cascade(B, d, n, pool, R, island) {
    if (!R) return;
    const P = R.pts;
    for (let k = 0; k < d.steps; k++) {
      const A = P[d.i + 2 * k], Bq = P[d.i + 2 * k + 1], C = P[Math.min(P.length - 1, d.i + 2 * k + 2)];
      if (!A || !Bq) break;
      const l = Math.hypot(Bq.x - A.x, Bq.z - A.z) || 1, sd = { ...d, x: A.x, y: A.y, z: A.z, dx: (Bq.x - A.x) / l, dz: (Bq.z - A.z) / l, w: A.w };
      void sd;   // (its rock: boulders on each step's edge, render/terrain.worker.js)
      const h = A.y - Bq.y, lb = Math.hypot(C.x - Bq.x, C.z - Bq.z) || 1;
      const sb = { ...d, x: Bq.x, y: Bq.y, z: Bq.z, dx: (C.x - Bq.x) / lb, dz: (C.z - Bq.z) / lb };
      this.splashAt(B, sb, 0.5, 0, Bq.y, A.w * 0.5, h * 0.35, n + k * 0.1);
    }
    const end = P[d.j], prev = P[d.j - 1], l = Math.hypot(end.x - prev.x, end.z - prev.z) || 1;
    const se = { ...d, x: end.x, y: end.y, z: end.z, dx: (end.x - prev.x) / l, dz: (end.z - prev.z) / l };
    this.foamDisc(B, se, 1.5, 0, end.y + 0.05, Math.max(2, Math.min(pool ? pool.r * 0.7 : 4, 1.5 + d.w * 0.4)), n);
  }

  /**
   * A ledge of hard cap rock at a lip: from a few metres upstream out to ov m over the cliff, across the water and its
   * banks; under the water (it runs over it) in the middle, rising to shoulders either side (and an island of rock where
   * twin falls part); a front face and an underside thick m deep, seen from the pool below; its edge a little ragged.
   */
  ledge(B, d, island, W, ov, thick, gap = null, back = 6) {
    const ww = W / 2, half = ww + (back > 3 ? 6 : 2.5), NX = 20, b0 = B.lp.length / 3;
    const hsh = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7 + d.x * 0.013 + d.z * 0.007) * 43758.5453; return v - Math.floor(v); };
    // rows: back (upstream, buried), top front edge, down the face, the face's foot, back under (the underside)
    const rows = [[-back, 0], [ov, 0], [ov + 0.15, -thick * 0.45], [ov - 0.25, -thick], [-back * 0.6, -thick]];
    for (let r = 0; r < rows.length; r++) for (let c = 0; c <= NX; c++) {
      const across = ((c / NX) * 2 - 1) * half, inGap = gap && Math.abs(across - gap[0]) < gap[1] / 2, inWater = Math.abs(across) < ww && !inGap;
      const shoulder = inWater ? -0.3 : inGap ? 0.9 + hsh(c, 5) * 0.6 : 0.25 + 0.9 * Math.min(1, (Math.abs(across) - ww) / 4) + hsh(c, 3) * 0.5;
      const jag = (hsh(c, r) - 0.5) * 0.7, [along, dy] = rows[r], al = along + (r && r < 4 ? jag : 0);
      const p = this.at(d, al, 0, across);
      let y = d.y + shoulder + dy;
      if (r === 0) y = Math.min(y, island.height(p[0], p[2]) - 0.2);   // (its back sinks into the bank)
      if (r === 4) y = Math.min(y, d.y + dy);
      B.lp.push(p[0], y, p[2]);
      const grey = 0.14 + hsh(c, r + 7) * 0.05 - (r >= 2 ? 0.025 : 0) - (inWater && r <= 1 ? 0.05 : 0), warm = r === 2 ? 0.015 : 0;   // (linear: a dark grey stone, darker wet)
      B.lc.push(grey + warm, grey + warm * 0.6, grey);
    }
    for (let r = 0; r + 1 < rows.length; r++) for (let c = 0; c < NX; c++) { const a = b0 + r * (NX + 1) + c, b = a + NX + 1; B.li.push(a, b, a + 1, a + 1, b, b + 1); }
  }

  /** A two-tier fall's shelf: a slab of rock standing out from the cliff, from x0 to x1 downstream, half m each side. */
  shelf(B, d, x0, x1, y, half) {
    const NX = 12, b0 = B.lp.length / 3, hsh = (a, b) => { const v = Math.sin(a * 71.3 + b * 19.1 + d.x * 0.011) * 43758.5453; return v - Math.floor(v); };
    const rows = [[x0, 0], [x1, 0], [x1 + 0.2, -1.2], [x1 - 0.3, -2.6], [x0, -2.6]];
    for (let r = 0; r < rows.length; r++) for (let c = 0; c <= NX; c++) {
      const across = ((c / NX) * 2 - 1) * half, edge = Math.abs(across) / half, [al, dy] = rows[r];
      const p = this.at(d, al + (r && r < 4 ? (hsh(c, r) - 0.5) * 0.8 : 0) - edge * edge * 1.5, 0, across);
      B.lp.push(p[0], y + dy + (edge > 0.7 ? (edge - 0.7) * 2 : -0.2) + hsh(c, 9) * 0.2, p[2]);
      const grey = 0.13 + hsh(c, r + 3) * 0.05; B.lc.push(grey + 0.01, grey + 0.006, grey);
    }
    for (let r = 0; r + 1 < rows.length; r++) for (let c = 0; c < NX; c++) { const a = b0 + r * (NX + 1) + c, b = a + NX + 1; B.li.push(a, b, a + 1, a + 1, b, b + 1); }
  }

  /**
   * A fall's pool's rock wall (2026-10-03, on the phone: "grey dark wall ... made of angled carved rocks, not a 2d
   * surface ... more of a 3d mesh"; the first walls had gaps and see-through spots where their top met the ground):
   * dark stone carved into angular blocks — columns of rock a few metres wide standing out by their own amounts, broken
   * across at their own heights, each face a flat facet — round the pool's back and sides, from under its water up to
   * the clifftop, then over the top and down into the ground behind (no edge left floating), its ends buried in the
   * banks. Behind the falling water it stands back under the cap rock, so the water falls clear in front of it.
   */
  wall(B, d, pool, island, W, ov) {
    const span = d.span || 2.55, back = Math.atan2(d.z - pool.z, d.x - pool.x), b0 = B.wp.length / 3;
    const NA = Math.max(24, Math.min(80, Math.round(2 * span * pool.r / 3.2)));
    const hsh = (a, b, c = 0) => { const v = Math.sin(a * 91.7 + b * 47.3 + c * 13.1 + pool.x * 0.017 + pool.z * 0.029) * 43758.5453; return v - Math.floor(v); };
    const under = d.y - (d.thick || 3) + 0.2, ledgeHalf = W / 2 + 6, yBot = pool.level - 2.2;
    const cols = [];
    for (let j = 0; j <= NA; j++) {
      const a = back + ((j / NA) * 2 - 1) * span, ca = Math.cos(a), sa = Math.sin(a), sh = lakeShore(pool, a), rim = pool.r * sh - 2.2;
      const x = pool.x + ca * rim, z = pool.z + sa * rim, gAt = o => island.height(x + ca * o, z + sa * o);
      const fx = (x - d.x) * d.dx + (z - d.z) * d.dz, lat = Math.abs(-(x - d.x) * d.dz + (z - d.z) * d.dx);
      cols.push({ ca, sa, x, z, top: Math.min(d.y + 1.2, Math.max(gAt(6.5), gAt(9)) - 0.2), gAt, behind: lat < ledgeHalf && fx < ov + 1.5, end: j <= 1 || j >= NA - 1 });
    }
    for (let it = 0; it < 4; it++) { const t = cols.map(c => c.top); for (let j = 1; j < NA; j++) cols[j].top = (t[j - 1] + 2 * t[j] + t[j + 1]) / 4; }
    let along = 0;
    const tops = cols.map(c => Math.max(yBot + 2, c.behind ? Math.min(c.top, under) : c.top)), NR = Math.max(4, Math.min(44, Math.ceil((Math.max(...tops) - yBot) / 3.8)));
    for (let j = 0; j <= NA; j++) {
      const c = cols[j];
      if (j) along += Math.hypot(c.x - cols[j - 1].x, c.z - cols[j - 1].z);
      const top = tops[j], maxIn = c.behind ? 0.7 : 2.6;
      // the rock column this place belongs to (3–6 m wide), broken across every 4–9 m at heights of its own
      const bw = 3 + 3 * hsh(Math.floor(along / 4.5), 1), col = Math.floor(along / bw + hsh(Math.floor(along / 9), 2) * 0.6);
      for (let r = 0; r <= NR + 2; r++) {
        let x, y, z;
        if (r <= NR) {
          const f = r / NR;
          y = yBot + (top - yBot) * f + (r > 0 && r < NR ? (hsh(j, r, 3) - 0.5) * 1.4 : 0);
          const brk = 4 + 5 * hsh(col, 7), band = Math.floor((y + hsh(col, 8) * brk) / brk);
          // how far the rock stands out here (toward the water): its column's own, its block's own, a tilt across the
          // block (its face leaning), jitter — the steps between them become the slanted facets of carved rock
          let inw = 0.35 + 1.1 * hsh(col, 4) + 0.9 * hsh(col, band, 5) + (fract((y + hsh(col, 8) * brk) / brk) - 0.5) * (hsh(col, band, 6) - 0.5) * 2.6 + (hsh(j, r, 9) - 0.5) * 0.3;
          inw = c.end ? -3 : Math.max(0.1, Math.min(maxIn, inw * (c.behind ? 0.4 : 1)));
          if (r === 0) inw = Math.max(inw, 0.8);
          x = c.x - c.ca * inw; z = c.z - c.sa * inw;
        } else if (r === NR + 1) {
          // over the top: a rim of rock 5 m back, standing just clear of the ground there
          const o = c.behind ? 1.5 : 5;
          y = c.behind ? top + 0.1 : Math.max(top, c.gAt(5), c.gAt(7)) + 0.5 + (hsh(j, 11) - 0.5) * 0.6;
          x = c.x + c.ca * o; z = c.z + c.sa * o;
        } else {
          // and down into the ground behind it
          const o = c.behind ? 3 : 10;
          y = c.behind ? top - 1 : c.gAt(10) - 1.5;
          x = c.x + c.ca * o; z = c.z + c.sa * o;
        }
        B.wp.push(x, y, z);
        // dark grey stone, each block its own shade, the drop's own cast (warmer or cooler), wet and darker low down
        const g = (0.075 + 0.06 * hsh(col, Math.floor(y / 5), 12) + 0.015 * hsh(j, r, 13)) * (y < pool.level + 3 ? 0.72 : 1), t = (d.tint ?? 0.5) - 0.5;
        B.wc.push(g * (1 + 0.12 * t), g * (1 + 0.03 * t), g * (1 - 0.1 * t));
      }
    }
    const M = NR + 3;
    for (let j = 0; j < NA; j++) for (let r = 0; r < M - 1; r++) { const a = b0 + j * M + r, b = a + M; B.wi.push(a, a + 1, b, b, a + 1, b + 1); }
  }

  /** The buttress parting twin falls: a carved column of dark rock from the ledge down into the pool, out from the wall. */
  buttress(B, d, center, gap, ov) {
    const NR = Math.max(6, Math.min(40, Math.round(d.F / 3))), b0 = B.wp.length / 3, half = gap * 0.42, foot = d.y - d.F - 1.6;
    const hsh = (a, b) => { const v = Math.sin(a * 63.7 + b * 21.9 + d.x * 0.031) * 43758.5453; return v - Math.floor(v); };
    // its outline (a U in plan, from the wall round its front), jagged, wider toward its foot
    const ring = [[-2, -1], [-0.3, -1.05], [ov - 0.8, -0.8], [ov - 0.1, -0.2], [ov - 0.3, 0.45], [ov - 0.9, 0.95], [-0.3, 1.05], [-2, 1]];
    for (let r = 0; r <= NR; r++) {
      const f = r / NR, y = d.y + 0.6 + (foot - d.y - 0.6) * f, grow = 0.85 + 0.35 * f;
      ring.forEach(([al, sd], k) => {
        const jx = (hsh(r, k) - 0.5) * 0.7, jz = (hsh(k, r + 9) - 0.5) * 0.7;
        B.wp.push(...this.at(d, (al > 0 ? al * grow + f * 1.5 : al) + jx, y + (r && r < NR ? (hsh(r, k + 3) - 0.5) * 0.8 : 0), center + sd * half * grow + jz));
        const g = 0.08 + 0.05 * hsh(Math.floor(r / 3), k); B.wc.push(g, g, g * 0.97);
      });
    }
    const M = ring.length;
    for (let r = 0; r < NR; r++) for (let k = 0; k + 1 < M; k++) { const a = b0 + r * M + k, b = a + M; B.wi.push(a, b, a + 1, a + 1, b, b + 1); }
  }

  /** The falls' meshes, one draw call each, from the lists buildFalls filled. */
  finishFalls(B) {
    const geo = (P, attrs, I) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); for (const [name, A, k] of attrs) g.setAttribute(name, new THREE.Float32BufferAttribute(A, k)); if (I) g.setIndex(I); g.computeBoundingSphere(); return g; };
    const glow = (k, day) => `totalEmissiveRadiance += vec3(0.55, 0.6, 0.64) * ${k} * (0.08 + 0.3 * ${day});`;
    const add = [];
    // ---- the curtains
    if (B.cp.length) {
      const cg = geo(B.cp, [['aFall', B.cf, 4], ['aFallB', B.cb, 4]], B.ci); cg.computeVertexNormals();
      const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0.5 });
      cm.onBeforeCompile = sh => {
        sh.uniforms.uWTime = GU.uTime; sh.uniforms.uWDay = GU.uDay;
        sh.vertexShader = 'attribute vec4 aFall, aFallB;\nvarying vec4 vFall, vFallB;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFall = aFall; vFallB = aFallB;');
        sh.fragmentShader = 'uniform float uWTime, uWDay;\nvarying vec4 vFall, vFallB;\n' + NOISE_GLSL + '\n' + sh.fragmentShader
          .replace('#include <color_fragment>', `#include <color_fragment>
          // each bit of the curtain is water that left the lip at time 'launch': its pattern falls with it, stretching as
          // it speeds up — columns of water across, pulses down; each fall its own (seed)
          float c = vFall.x, t = vFall.y, T = vFall.z, W = vFall.w, seed = vFallB.y, launch = uWTime - t * T + seed * 17.0, cx = (c - 0.5) * W + seed * 31.0;
          float px = max(fwidth(cx), 0.02);
          float col = wfN(vec2(cx * 1.4, launch * 0.7)) * 0.5 + wfN(vec2(cx * 4.0, launch * 1.6 + 5.0)) * 0.32;
          col += mix(0.09, wfN(vec2(cx * 10.0, launch * 3.0 + 9.0)) * 0.18, smoothstep(0.25, 0.06, px));
          // the sheet thins raggedly toward its sides and breaks up as it falls
          float edge = abs(c - 0.5) * 2.0 + (wfN(vec2(launch * 2.2, c * 4.0 + 3.0 + seed)) - 0.5) * (0.12 + 0.35 * t);
          float side = 1.0 - smoothstep(0.62, 0.98, edge);
          float a = side * mix(0.95, 0.62, t) * smoothstep(0.12 + 0.32 * t, 0.42 + 0.3 * t, col) * vFallB.x;
          // over the rock's edge: smooth glassy water, green, turning white within the first metres of the fall
          float glass = 1.0 - smoothstep(0.0, 0.1, t);
          diffuseColor.rgb = mix(vec3(0.93, 0.96, 0.98), vec3(0.3, 0.55, 0.5), glass * 0.75);
          diffuseColor.a = clamp(mix(a, 0.82 * side, glass), 0.0, 1.0) * (1.0 - smoothstep(0.88, 1.0, t) * 0.5);
          float wfFoam = 1.0 - glass;`)
          .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + glow('wfFoam', 'uWDay'));
      };
      cm.customProgramCacheKey = () => 'waterfall-curtain2';
      const m = new THREE.Mesh(cg, cm); m.renderOrder = 3; add.push([m, cm, cg]);
    }
    // ---- the white water on the pools
    if (B.fp.length) {
      const fg = geo(B.fp, [['aFoam', B.ff, 4], ['normal', new Float32Array(B.fp.length).map((_, q) => (q % 3 === 1 ? 1 : 0)), 3]], B.fi);
      const fm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, transparent: true, depthWrite: false, envMapIntensity: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      fm.onBeforeCompile = sh => {
        sh.uniforms.uWTime = GU.uTime; sh.uniforms.uWDay = GU.uDay;
        sh.vertexShader = 'attribute vec4 aFoam;\nvarying vec4 vFoam;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFoam = aFoam;');
        sh.fragmentShader = 'uniform float uWTime, uWDay;\nvarying vec4 vFoam;\n' + NOISE_GLSL + '\n' + sh.fragmentShader
          .replace('#include <color_fragment>', `#include <color_fragment>
          // churned white water boiling up where the fall lands and spreading out in rings of lace, thinning outward
          float rr = vFoam.x, seed = vFoam.w;
          vec2 q = vFoam.yz;
          float ring = length(q) * 0.55 - uWTime * 0.9;
          // (rings from the distance alone, in a field of the position: an angle would leave a seam where it wraps)
          float boil = wfN(q * 0.9 + vec2(seed * 7.0, uWTime * 0.8)) * 0.55 + wfN(vec2(ring, 0.0) + q * 0.35 + seed) * 0.45;
          float core = 1.0 - smoothstep(0.0, 0.45, rr);
          float a = max(core * 0.92, smoothstep(0.42 - 0.25 * (1.0 - rr), 0.68, boil) * (1.0 - smoothstep(0.55, 1.0, rr)));
          diffuseColor.rgb = vec3(0.92, 0.95, 0.97);
          diffuseColor.a = clamp(a, 0.0, 1.0) * 0.95;`)
          .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\ntotalEmissiveRadiance += vec3(0.5, 0.55, 0.6) * (0.06 + 0.25 * uWDay);');
      };
      fm.customProgramCacheKey = () => 'waterfall-foam';
      const m = new THREE.Mesh(fg, fm); m.renderOrder = 2; add.push([m, fm, fg]);
    }
    // ---- the cap rock, shelves and cascade lips
    if (B.lp.length) {
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(B.lp, 3)); lg.setAttribute('color', new THREE.Float32BufferAttribute(B.lc, 3)); lg.setIndex(B.li); lg.computeVertexNormals();
      const lm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true, side: THREE.DoubleSide });
      const m = new THREE.Mesh(lg, lm); m.castShadow = true; m.receiveShadow = true; add.push([m, lm, lg]);
    }
    // ---- the carved rock walls and buttresses: flat facets of dark stone (angular, not smooth), moss on the ledges
    // that face up, a fine grain so close up it reads as rock
    if (B.wp.length) {
      const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(B.wp, 3)); wg.setAttribute('color', new THREE.Float32BufferAttribute(B.wc, 3)); wg.setIndex(B.wi); wg.computeBoundingSphere();
      const wm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, flatShading: true, side: THREE.DoubleSide });
      wm.onBeforeCompile = sh => {
        sh.vertexShader = 'varying vec3 vWPosW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vWPosW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = 'varying vec3 vWPosW;\n' + NOISE_GLSL + '\n' + sh.fragmentShader
          .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
            float grain = wfN(vWPosW.xz * 1.7 + vWPosW.y * 1.3) * 0.6 + wfN(vWPosW.xy * 4.1 + vWPosW.z) * 0.4;
            diffuseColor.rgb *= 0.86 + 0.28 * grain;
            float moss = smoothstep(0.45, 0.8, wN.y) * smoothstep(0.35, 0.7, wfN(vWPosW.xz * 0.35 + 3.0));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.09, 0.03), moss * 0.75);
          }`);
      };
      wm.customProgramCacheKey = () => 'waterfall-rock';
      const m = new THREE.Mesh(wg, wm); m.castShadow = true; m.receiveShadow = true; add.push([m, wm, wg]);
    }
    // ---- the skirts of spray bursting up where falls land: torn white veils rising and thinning, flickering upward
    if (B.sp.length) {
      const sg = geo(B.sp, [['aSpray', B.sa, 4]], B.si);
      const sm = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: GU.uTime, uDay: GU.uDay },
        vertexShader: `attribute vec4 aSpray; varying vec4 vS; varying vec3 vP; void main() { vS = aSpray; vP = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform float uTime, uDay; varying vec4 vS; varying vec3 vP;
          ${NOISE_GLSL}
          void main() {
            float an = vS.x, f = vS.y, H = vS.z, seed = vS.w;
            vec2 q = vec2(cos(an), sin(an)) * 2.6 + vec2(seed * 11.0, f * H * 0.35 - uTime * (1.6 + H * 0.05));
            float n = wfN(q) * 0.6 + wfN(q * 2.7 + 4.0) * 0.4;
            // seen edge-on (its sides) it fades: spray is a cloud, not a glass bowl
            vec3 nrm = normalize(cross(dFdx(vP), dFdy(vP))), vd = normalize(cameraPosition - vP);
            float face = smoothstep(0.15, 0.6, abs(dot(nrm, vd)));
            float a = smoothstep(0.4, 0.78, n) * (1.0 - smoothstep(0.2, 1.0, f)) * smoothstep(0.0, 0.08, f) * 0.55 * face;
            if (a < 0.01) discard;
            gl_FragColor = vec4(vec3(0.93, 0.96, 1.0) * (0.4 + 0.6 * uDay), a);
          }`,
      });
      const m = new THREE.Mesh(sg, sm); m.renderOrder = 4; add.push([m, sm, sg]);
    }
    // ---- droplets thrown out on their arcs
    if (B.dp.length) {
      const N = B.dp.length / 8, D = new Float32Array(B.dp), a4 = new Float32Array(N * 4), b4 = new Float32Array(N * 4);
      for (let k = 0; k < N; k++) { a4.set(D.subarray(k * 8, k * 8 + 4), k * 4); b4.set(D.subarray(k * 8 + 4, k * 8 + 8), k * 4); }
      const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); dg.setAttribute('aDrop', new THREE.BufferAttribute(a4, 4)); dg.setAttribute('aDropB', new THREE.BufferAttribute(b4, 4));
      const dm = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, uniforms: { uTime: GU.uTime, uDay: GU.uDay },
        vertexShader: `attribute vec4 aDrop, aDropB; uniform float uTime; varying float vA;
          void main() {
            float F = aDropB.x, ang = aDropB.y, k = aDropB.z, life = 0.7 + F * 0.008 + k * 0.5;
            float t = fract(uTime / life + aDrop.w), tau = t * life;
            float vh = 1.5 + (F * 0.05 + 2.0) * k, vu = 2.5 + F * 0.07 * (0.4 + 0.6 * fract(k * 7.3));
            vec3 p = aDrop.xyz + vec3(cos(ang) * vh * tau, vu * tau - 4.9 * tau * tau, sin(ang) * vh * tau);
            vA = (1.0 - t) * step(aDrop.y - 0.5, p.y);
            vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
            gl_PointSize = clamp((0.35 + 0.4 * k) * 300.0 / -mv.z, 1.0, 24.0);
          }`,
        fragmentShader: `uniform float uDay; varying float vA;
          void main() { vec2 c = gl_PointCoord - 0.5; float r = dot(c, c); if (r > 0.25 || vA < 0.01) discard; gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * (0.4 + 0.6 * uDay), vA * 0.75 * (1.0 - r * 4.0)); }`,
      });
      const m = new THREE.Points(dg, dm); m.frustumCulled = false; m.renderOrder = 4; add.push([m, dm, dg]);
    }
    // ---- mist: billowing up from where falls land, drifting downstream, thinning as it rises
    if (B.mist.length) {
      const N = B.mist.length / 8, M = new Float32Array(B.mist), a4 = new Float32Array(N * 4), b4 = new Float32Array(N * 4);
      for (let k = 0; k < N; k++) { a4.set(M.subarray(k * 8, k * 8 + 4), k * 4); b4.set(M.subarray(k * 8 + 4, k * 8 + 8), k * 4); }
      const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); mg.setAttribute('aMist', new THREE.BufferAttribute(a4, 4)); mg.setAttribute('aMistB', new THREE.BufferAttribute(b4, 4));
      const mm = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, uniforms: { uTime: GU.uTime, uDay: GU.uDay },
        vertexShader: `attribute vec4 aMist, aMistB; uniform float uTime; varying float vA;
          void main() {
            float F = aMistB.x, t = fract(uTime * (0.06 + 0.05 * fract(aMist.w * 7.0)) + aMist.w), R = aMistB.w;
            vec2 drift = aMistB.yz * t * (3.0 + F * 0.12);
            vec3 p = aMist.xyz + vec3(sin(aMist.w * 40.0 + uTime * 0.3) * R * t + drift.x, 0.3 + t * (1.5 + F * 0.32), cos(aMist.w * 31.0 + uTime * 0.27) * R * t + drift.y);
            vA = (1.0 - t) * smoothstep(0.0, 0.1, t);
            vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
            gl_PointSize = clamp((5.0 + F * 0.1 + R * 0.6 + 16.0 * t) * 300.0 / -mv.z, 1.0, 360.0);
          }`,
        fragmentShader: `uniform float uDay; varying float vA;
          void main() { vec2 c = gl_PointCoord - 0.5; float r = dot(c, c); if (r > 0.25) discard; gl_FragColor = vec4(vec3(0.92, 0.95, 1.0) * (0.38 + 0.62 * uDay), vA * 0.24 * exp(-r * 10.0)); }`,
      });
      const m = new THREE.Points(mg, mm); m.frustumCulled = false; m.renderOrder = 5; add.push([m, mm, mg]);
    }
    for (const [m, mat, g] of add) { this.group.add(m); this.mats.push(mat); this.geos.push(g); }
  }

  /** Ripples flow downstream. */
  update(dt) { this.tex.offset.y -= dt * 0.35; }
  dispose() { for (const g of this.geos) g.dispose(); for (const m of this.mats) m.dispose(); this.tex.dispose(); }
}
