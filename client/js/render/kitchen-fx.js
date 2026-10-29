// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Order Up's effects kit (phase 2 of PLAN-RESTAURANT-GAME.md, 2026-10-26, the product owner: "new 3d assets, game
// mechanics, and new effects"): one pool of soft sprites, one draw call, for what a kitchen gives off. The game (phase 3
// on) bursts them where things happen: app.kitchenFx.burst(kind, x, y, z, n). Until then the café kitchen you look
// into is alive by itself: the espresso machine's groups and its wand and the milk steamer's wands puff steam in turns,
// the oven breathes heat from its vent, the sandwich press sizzles, the sink and the dish under the pass's lamps steam.
//   kinds   steam (white, swelling, rising), smoke (grey: overdone, burnt), spark (orange, quick, falling: a sizzle),
//           fleck (green bits off the chopping board), sparkle (gold twinkle: a Supreme dish), flame (licking up: a
//           fire), foam (the extinguisher's, thrown and falling)
// Drawn only while some are alive; the stations' own puffs only on the floor looked into and near the camera.
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { GU } from './scene.js';
import { AUTO } from '/shared/orderup/rules.js';

const N = 900, NEAR = 45;
export const KINDS = ['steam', 'smoke', 'spark', 'fleck', 'sparkle', 'flame', 'foam'];
//            life  size0  size1  up    spread  gravity  colour              alpha  lit (glows at night)
const SPEC = [[1.9, 0.10, 0.5, 0.42, 0.08, 0, [0.96, 0.97, 0.98], 0.34, 0],
  [2.4, 0.14, 0.75, 0.5, 0.14, 0, [0.33, 0.32, 0.31], 0.42, 0],
  [0.5, 0.05, 0.01, 1.1, 0.8, -6, [1.0, 0.62, 0.22], 1.0, 1],
  [0.6, 0.045, 0.035, 1.0, 0.7, -7, [0.45, 0.72, 0.3], 1.0, 0],
  [0.9, 0.1, 0.0, 0.35, 0.35, 0, [1.0, 0.86, 0.36], 1.0, 1],
  [0.6, 0.17, 0.04, 1.25, 0.12, 0, [1.0, 0.46, 0.12], 0.9, 1],
  [1.2, 0.08, 0.22, 0.3, 1.2, -3, [0.97, 0.98, 1.0], 0.85, 0]];
// the stations' own puffs: [item-local x, y, z, kind, per second, cycle s (0: always), on s, only while this kind is on it]
const OWN = {
  ou_espresso: [[-0.26, 1.14, 0.2, 'steam', 0.9, 7, 2.5], [0.06, 1.14, 0.2, 'steam', 0.9, 9, 2.5], [0.27, 1.04, 0.19, 'steam', 4, 11, 3]],
  ou_steamer: [[-0.18, 1.04, 0.17, 'steam', 5, 10, 4], [0.04, 1.04, 0.17, 'steam', 4, 13, 3.5]],
  ou_oven: [[0, 1.66, 0.1, 'steam', 1.2, 0, 0]],
  ou_press: [[0, 1.06, 0.16, 'steam', 1.6, 0, 0], [0, 1.02, 0.2, 'spark', 0.6, 0, 0]],
  ou_sink: [[-0.42, 0.96, 0, 'steam', 0.5, 0, 0]],
  ou_pass: [[-0.3, 1.13, 0, 'steam', 0.7, 0, 0]],
  // (the new appliances, 2026-10-28: the fryer's oil, the grill's grates (sparks off the coals), the griddle, the toaster's
  // mouth, the tea urn's lid; each only while something cooks on it)
  ou_fryer: [[0.19, 1.0, 0.03, 'steam', 2.2, 0, 0]],
  ou_grill: [[0.1, 1.1, 0.04, 'steam', 1.8, 0, 0], [0.1, 1.04, 0.04, 'spark', 0.5, 0, 0]],
  ou_griddle: [[-0.25, 1.02, 0, 'steam', 1.4, 0, 0]],
  ou_toaster: [[-0.05, 1.14, 0.08, 'steam', 0.7, 0, 0]],
  ou_kettle: [[-0.2, 1.4, -0.14, 'steam', 1.4, 0, 0]],
  // the pizza oven's flue and mouth, the stove's pot on the boil, the wok's flare and steam while it is tossed
  ou_pizza_oven: [[0, 2.0, -0.2, 'steam', 0.8, 0, 0], [0, 1.0, 0.36, 'spark', 0.7, 0, 0]],
  ou_stove: [[-0.24, 1.18, 0.16, 'steam', 2.2, 0, 0, 'pasta'], [0.24, 1.08, 0.16, 'steam', 1.2, 0, 0, 'soup']],
  ou_wok: [[-0.08, 1.16, 0, 'steam', 3, 0, 0], [-0.08, 1.1, 0, 'spark', 2.5, 0, 0]],
  // the tandoor's mouth and the bamboo steamer's baskets while something cooks in them
  ou_tandoor: [[-0.08, 1.08, 0, 'steam', 1.2, 0, 0], [-0.08, 1.04, 0, 'spark', 0.6, 0, 0]],
  ou_bamboo: [[-0.1, 1.24, 0, 'steam', 3, 0, 0]],
};

let app = null, fx = null;

class KitchenFx {
  constructor(scene) {
    this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 3); this.grav = new Float32Array(N);
    this.born = new Float32Array(N).fill(-99); this.kind = new Float32Array(N); this.seed = new Float32Array(N);
    this.next = 0; this.live = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aBorn', new THREE.BufferAttribute(this.born, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aKind', new THREE.BufferAttribute(this.kind, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1).setUsage(THREE.DynamicDrawUsage));
    const uA = SPEC.map(s => new THREE.Vector4(s[0], s[1], s[2], s[8])), uB = SPEC.map(s => new THREE.Vector4(...s[6], s[7]));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uNow: { value: 0 }, uScale: { value: 1000 }, uNight: GU.uNight, uA: { value: uA }, uB: { value: uB } },
      vertexShader: `attribute float aBorn, aKind, aSeed; uniform float uNow, uScale, uNight; uniform vec4 uA[7], uB[7];
        varying float vA, vS, vK; varying vec3 vC;
        void main() { int k = int(aKind + 0.5); vec4 a = uA[k], b = uB[k]; float t = (uNow - aBorn) / a.x;
          float on = (t >= 0.0 && t < 1.0) ? 1.0 : 0.0;
          vA = on * b.a * smoothstep(0.0, 0.1, t) * (1.0 - t); vS = aSeed; vK = aKind;
          if (k == 4) vA *= 0.45 + 0.55 * sin(uNow * 28.0 + aSeed * 40.0);
          vC = b.rgb * mix(1.0, mix(0.45, 1.6, a.w), uNight);
          vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = on > 0.0 ? mix(a.y, a.z, t) * uScale / max(0.5, -mv.z) : 0.0; }`,
      fragmentShader: `varying float vA, vS, vK; varying vec3 vC;
        void main() { vec2 p = gl_PointCoord - 0.5; float r = length(p); if (r > 0.5) discard;
          float soft = vK < 1.5 || vK > 5.5 ? (0.6 + 0.4 * sin(p.x * 10.0 + vS * 40.0) * sin(p.y * 8.0 + vS * 23.0)) * smoothstep(0.5, 0.0, r) : smoothstep(0.5, 0.15, r);
          if (vK > 3.5 && vK < 4.5) soft = max(smoothstep(0.08, 0.0, abs(p.x)) , smoothstep(0.08, 0.0, abs(p.y))) * smoothstep(0.5, 0.1, r) + smoothstep(0.2, 0.0, r);
          gl_FragColor = vec4(vC, soft * vA); }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = 4; this.points.name = 'kitchen-fx'; this.points.visible = false;
    scene.add(this.points);
  }
  /** n of kind at x, y, z (world), now in seconds; o.spread: how far apart they start, o.up: their lift. */
  burst(kind, x, y, z, n = 1, now = performance.now() / 1000, o = {}) {
    const k = KINDS.indexOf(kind); if (k < 0) return;
    const sp = SPEC[k], spread = o.spread ?? 0.04;
    for (let i = 0; i < n; i++) {
      const j = this.next; this.next = (this.next + 1) % N;
      this.pos[j * 3] = x + (Math.random() - 0.5) * spread; this.pos[j * 3 + 1] = y + (Math.random() - 0.5) * spread * 0.5; this.pos[j * 3 + 2] = z + (Math.random() - 0.5) * spread;
      const a = Math.random() * Math.PI * 2, s = sp[4] * (0.3 + Math.random() * 0.7);
      this.vel[j * 3] = Math.cos(a) * s; this.vel[j * 3 + 1] = (o.up ?? sp[3]) * (0.6 + Math.random() * 0.6); this.vel[j * 3 + 2] = Math.sin(a) * s;
      this.grav[j] = sp[5]; this.born[j] = now; this.kind[j] = k; this.seed[j] = Math.random();
      this.live = Math.max(this.live, sp[0]);
    }
  }
  update(now, dt) {
    this.mat.uniforms.uNow.value = now;
    if (this.live <= 0) { this.points.visible = false; return; }
    this.points.visible = true; this.live -= dt;
    const W = GU.uWind?.value, wx = (W?.x || 0) * 0.02, wz = (W?.z || 0) * 0.02, d = Math.exp(-dt * 1.2);
    for (let j = 0; j < N; j++) {
      if (now - this.born[j] > 2.5) continue;
      this.vel[j * 3] = this.vel[j * 3] * d + wx * dt; this.vel[j * 3 + 2] = this.vel[j * 3 + 2] * d + wz * dt; this.vel[j * 3 + 1] += this.grav[j] * dt;
      this.pos[j * 3] += this.vel[j * 3] * dt; this.pos[j * 3 + 1] += this.vel[j * 3 + 1] * dt; this.pos[j * 3 + 2] += this.vel[j * 3 + 2] * dt;
    }
    const g = this.points.geometry;
    for (const n of ['position', 'aBorn', 'aKind', 'aSeed']) g.attributes[n].needsUpdate = true;
  }
}

// ---- the stations' own puffs on the floor looked into
let list = null, from = null, acc = [], last = 0, puffs = 0;
const byType = {};   // (puffs so far by station: the lab's check)
function emitters() {
  const ents = app.inter?.foc?.entries;
  if (ents === from) return list;
  from = ents; list = []; acc = [];
  for (const e of ents || []) for (const [lx, ly, lz, kind, rate, cyc, on, only] of OWN[e.t] || []) {
    const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
    list.push({ t: e.t, id: e.id, x: e.x + lx * c + lz * s, y: e.y + ly, z: e.z - lx * s + lz * c, kind, rate, cyc, on, only, ph: (e.x * 7.3 + e.z * 3.1) % (cyc || 1) });
    acc.push(Math.random());
  }
  return list;
}
/** Whether a station's puff is due (2026-10-27, "the deck oven and sandwich press look like they are steaming and maybe
 *  sparking ... they should reset and stop steaming or sparking after not being used"): in a Rush (R, its state) only while
 *  it works: the espresso machine pulling a shot, milk on the steamer, something in the oven or the press (the press's
 *  sparks only until it is done), the sink while washing up; out of a Rush only the coffee bar, now and then. */
function working(m, R) {
  if (!R) return m.t === 'ou_espresso' || m.t === 'ou_steamer';
  const st = R.st?.[m.id]; if (!st || R.over) return false;
  const a = AUTO[m.t];
  switch (m.t) {
    case 'ou_espresso': return st.slot != null && (st.loaded || st.prog > 0) && st.prog < a.cook + 1.5;
    case 'ou_steamer': return st.slot != null;
    case 'ou_oven': return st.slot != null;
    case 'ou_press': return st.slot != null && (m.kind !== 'spark' || st.prog < a.cook + a.perfect);
    case 'ou_sink': return st.work > 0;
    case 'ou_fryer': case 'ou_griddle': case 'ou_toaster': case 'ou_tandoor': case 'ou_bamboo': return st.slot != null;
    case 'ou_grill': return st.slot != null && (m.kind !== 'spark' || st.prog < a.cook + a.perfect);
    case 'ou_kettle': return st.slot != null && st.prog < a.cook;
    case 'ou_pizza_oven': return m.kind === 'steam' || st.slot != null;   // (its fire is always lit: the flue smokes)
    case 'ou_stove': return st.slot != null && R.items?.[st.slot]?.k === m.only;   // (the pot of water for the pasta, the saucepan of soup)
    case 'ou_wok': { const was = m.lastProg; m.lastProg = st.prog; return st.slot != null && st.prog !== was; }   // (only while it is tossed)
    default: return false;
  }
}
function frame() {
  const now = performance.now() / 1000, dt = Math.min(0.1, last ? now - last : 0); last = now;
  const cam = app.stage?.camera, el = app.stage?.renderer?.domElement;
  if (cam?.isPerspectiveCamera) fx.mat.uniforms.uScale.value = (el?.height || 1000) / (2 * Math.tan(cam.fov * Math.PI / 360));
  if (S.focus?.b >= 0 && cam && dt > 0) {
    const L = emitters();
    for (let i = 0; i < L.length; i++) {
      const m = L[i];
      const R = app.orderUp?.game?.S;
      if (!working(m, R)) continue;
      if (!R && m.cyc && ((now + m.ph) % m.cyc) > m.on) continue;   // (a wand steams a while, then rests)
      if (Math.abs(cam.position.x - m.x) > NEAR || Math.abs(cam.position.z - m.z) > NEAR) continue;
      acc[i] += m.rate * dt;
      while (acc[i] >= 1) { acc[i] -= 1; fx.burst(m.kind, m.x, m.y, m.z, 1, now); puffs++; byType[m.t] = (byType[m.t] || 0) + 1; }
    }
  }
  fx.update(now, dt);
}

export function init(a) {
  app = a;
  const scene = a.stage?.scene; if (!scene) return;
  fx = new KitchenFx(scene);
  bus.on('frame', frame);
  a.kitchenFx = {
    burst: (kind, x, y, z, n = 1, o = {}) => fx.burst(kind, x, y, z, n, performance.now() / 1000, o),
    get state() { return { emitters: emitters()?.length || 0, puffs, live: fx.points.visible, byType: { ...byType } }; },
  };
}
