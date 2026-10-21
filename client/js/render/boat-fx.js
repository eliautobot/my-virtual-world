// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The boats' white water (docs/features/fishing.md §Boats; redone 2026-10-15 — the product owner: "the water trails need
// some serious work … way too basic"). Drawn into the water itself (render/water-marks.js: it rides the waves and is lit
// as water), each boat leaves:
//   - its wash: the propellers' churned track — boiling white water at the stern, breaking up into lace and streaks,
//     and under it a wide band of milky, bubbly water that lingers long after the foam has gone;
//   - its wake's arms: two trains of waves opening behind it at the Kelvin angle (19.5°), feathered into short crests
//     the light catches, white along their first crest at speed;
//   - the waves between them (transverse, as long as the speed makes them: 2πU²/g), fading as it gets on the plane;
//   - a bow wave standing round the hull with white water hugging it where it pushes through.
// And spray (render/spray.js): sheets of drops thrown off both chines at speed (more on the outside of a turn), a
// rooster tail behind the outboards, mist, a burst when the hull slams down off a wave.
import * as THREE from 'three';
import { waterMarks } from './water-marks.js';
import { spray } from './spray.js';
import { GU } from './scene.js';

const TRAILS = 4, PTS = 110, LIFE = 26, KELVIN = Math.tan(19.5 * Math.PI / 180);
const RIB = 4, PV = (PTS + 1) * 2;   // ribbons a boat (the waves between, the wash, two arms); vertices a ribbon

const FRAG = /* glsl */`
  float a = vA.x, k = vA.z;
  if (k < 0.5) {          // the transverse waves, between the arms
    h = vB.y * cos(6.2832 * vA.y / max(vA.w, 0.5)) * (1.0 - smoothstep(0.5, 1.0, abs(a)));
  } else if (k < 1.5) {   // the wash
    float n = mkN(vW * 0.7 + vec2(uT * 0.45, -uT * 0.3)) * 0.55 + mkN(vW * 2.0 - uT * 0.8) * 0.3 + mkN(vW * 5.2 + uT * 1.1) * 0.15;
    // streaks along the track (the foam drawn out behind the boat as it breaks up)
    float st = mkN(vec2(a * 7.0, vA.y * 0.12)) * 0.5 + mkN(vec2(a * 15.0 + 3.0, vA.y * 0.35)) * 0.3 + mkN(vW * 1.3 - uT * 0.5) * 0.2;
    float aa = abs(a), core = 1.0 - smoothstep(0.25, 0.95, aa + (n - 0.5) * 0.6 + (st - 0.5) * 0.3);
    foam = vB.x * core * mix(0.45 + 0.8 * n, smoothstep(0.3, 0.75, st) * 1.5, clamp(1.1 - vB.x * 1.4, 0.0, 1.0));   // (boiling while thick, streaky as it goes)
    aer = vB.z * (1.0 - smoothstep(0.5, 1.05, aa + (n - 0.5) * 0.35));
    h = vB.y * core * ((n - 0.5) * 2.4 - 0.35);   // hollowed a little, boiling
  } else if (k < 2.5) {   // an arm: a crest on its outer side, a smaller one inside, feathered along
    float fe = 0.55 + 0.45 * sin(6.2832 * vA.y / vA.w + a * 2.2);
    float c = cos(6.2832 * (a - 0.38) * 1.15) * exp(-pow((a - 0.22) / 0.62, 2.0));
    float n = mkN(vW * 1.5 + uT * 0.25) * 0.6 + mkN(vW * 4.2 - uT * 0.5) * 0.4;
    h = vB.y * c * fe;
    foam = vB.x * smoothstep(0.4, 0.95, c * (0.55 + 0.45 * fe)) * (0.45 + 0.85 * n);
    aer = vB.z * smoothstep(0.2, 0.9, c);
  } else {                // round the hull: a bow wave, white water where it pushes through
    vec2 q = vA.xy; float L = vA.w, B = vB.z, hz = q.y / (L * 0.5);
    float hw = B * 0.5 * (hz > 0.1 ? sqrt(max(0.0, 1.0 - pow((hz - 0.1) / 0.9, 2.0))) : 1.0);
    float d = max(abs(q.x) - hw, max(hz - 1.0, -1.0 - hz) * L * 0.5);
    float sp = vB.x, bowW = smoothstep(-0.8, 0.8, hz), out_ = smoothstep(-0.3, 0.0, d);
    float n = mkN(vW * 2.2 + uT * 0.9) * 0.6 + mkN(vW * 5.0 - uT * 1.3) * 0.4;
    float band = 0.3 + sp * 1.1;
    foam = sp * (1.0 - smoothstep(0.0, band, d + (n - 0.5) * 0.5)) * out_ * (0.3 + 0.7 * bowW) * (0.7 + 0.5 * n);
    h = sp * 0.15 * exp(-pow((d - band * 0.6) / (band * 0.45 + 0.15), 2.0)) * bowW * out_;
    aer = foam * 0.6;
  }`;

const poisson = m => { let n = Math.floor(m); if (Math.random() < m - n) n++; return n; };

export class BoatFx {
  /** @param stage the page's Stage (render/scene.js) */
  constructor(stage) {
    this.marks = waterMarks(stage); this.spray = spray(stage, this.marks);
    const nv = TRAILS * (RIB * PV + 4), idx = [];
    for (let q = 0; q < TRAILS * RIB; q++) for (let i = 0; i < PTS; i++) { const a = q * PV + i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    for (let r = 0; r < TRAILS; r++) { const b = TRAILS * RIB * PV + r * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    this.pos = new Float32Array(nv * 3); this.aA = new Float32Array(nv * 4); this.aB = new Float32Array(nv * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aA', new THREE.BufferAttribute(this.aA, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aB', new THREE.BufferAttribute(this.aB, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, this.marks.material(FRAG)); this.mesh.name = 'boat-wake';
    this.trails = new Map(); this.used = 0;
    this.marks.add(this.mesh, () => this.trails.size > 0);
    this.wake = this.mesh;   // (checks look for it)
  }
  _v(v, x, z, a0, a1, a2, a3, b0, b1, b2, b3) {
    const o = v * 3, q = v * 4;
    this.pos[o] = x; this.pos[o + 1] = 0; this.pos[o + 2] = z;
    this.aA[q] = a0; this.aA[q + 1] = a1; this.aA[q + 2] = a2; this.aA[q + 3] = a3;
    this.aB[q] = b0; this.aB[q + 1] = b1; this.aB[q + 2] = b2; this.aB[q + 3] = b3;
  }
  /**
   * Once a frame. boats: [{ key, x, z, y (the water at its stern), heading, u (m/s ahead), planing, slam, L, B }] (the
   * nearest few first).
   */
  update(dt, t, boats) {
    const live = new Set();
    for (const b of boats.slice(0, TRAILS)) {
      live.add(b.key);
      let T = this.trails.get(b.key);
      const fx = Math.sin(b.heading), fz = Math.cos(b.heading), sx = b.x - fx * b.L * 0.5, sz = b.z - fz * b.L * 0.5;
      if (!T) { T = { pts: [], along: 0, px: sx, pz: sz, h: b.heading, yaw: 0, slam: 0, b }; this.trails.set(b.key, T); }
      T.along += Math.hypot(sx - T.px, sz - T.pz); T.px = sx; T.pz = sz;
      const dh = Math.atan2(Math.sin(b.heading - T.h), Math.cos(b.heading - T.h)); T.h = b.heading;
      T.yaw += ((dt > 0 ? dh / dt : 0) - T.yaw) * Math.min(1, dt * 4);
      T.b = b; T.seen = t; this.marks.level = b.y;
      const sp = Math.abs(b.u), last = T.pts[0];
      if (sp > 0.6 && (!last || Math.hypot(sx - last.x, sz - last.z) >= Math.max(0.7, sp * 0.11) || t - last.t > 0.8)) {
        T.pts.unshift({ x: sx, z: sz, bx: b.x + fx * b.L * 0.3, bz: b.z + fz * b.L * 0.3, fx, fz, sp, pl: b.planing || 0, t, along: T.along, L: b.L, B: b.B });
      }
      while (T.pts.length > PTS || (T.pts.length && t - T.pts[T.pts.length - 1].t > LIFE)) T.pts.pop();
      this._spray(b, T, dt, fx, fz, sp);
    }
    for (const [k, T] of [...this.trails]) if (!live.has(k)) { T.gone = true; if (!T.pts.length || t - T.pts[0].t > LIFE) this.trails.delete(k); }
    // the marks: each boat's ribbons and its hull's
    let r = 0;
    for (const T of [...this.trails.values()].slice(0, TRAILS)) { this._trail(r, T, t); r++; }
    const used = r, upto = Math.max(used, this.used);   // (a trail just gone: cleared, sent once more)
    for (; r < upto; r++) this._clear(r);
    this.used = used;
    // only what is in use goes to the GPU
    const g = this.mesh.geometry;
    for (const k of ['position', 'aA', 'aB']) {
      const at = g.attributes[k], n = at.itemSize;
      at.clearUpdateRanges();
      if (!upto) continue;
      at.addUpdateRange(0, upto * RIB * PV * n); at.addUpdateRange(TRAILS * RIB * PV * n, upto * 4 * n);
      at.needsUpdate = true;
    }
  }
  _clear(r) {
    for (let v = r * RIB * PV; v < (r + 1) * RIB * PV; v++) this._v(v, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    const h = TRAILS * RIB * PV + r * 4; for (let v = h; v < h + 4; v++) this._v(v, 0, 0, 0, 0, 3, 1, 0, 0, 0, 0);
  }
  _trail(r, T, t) {
    const b = T.b, fx = Math.sin(b.heading), fz = Math.cos(b.heading);
    // where it is now, then where it was (newest first)
    const P = T.gone ? T.pts : [{ x: T.px, z: T.pz, bx: b.x + fx * b.L * 0.3, bz: b.z + fz * b.L * 0.3, fx, fz, sp: Math.abs(b.u), pl: b.planing || 0, t, along: T.along, L: b.L, B: b.B }, ...T.pts];
    const m = Math.min(P.length, PTS + 1);
    for (let i = 0; i <= PTS; i++) {
      const p = P[Math.min(i, m - 1)], used = i < m && m > 1, age = t - p.t, end = used ? Math.min(1, (m - 1 - i) / 3) : 0;
      const rx = p.fz, rz = -p.fx, g6 = Math.min(1, p.sp / 6);
      // the waves between the arms (as long as the speed makes them; gone on the plane)
      const d = p.B * 0.5 + age * p.sp * KELVIN * 0.92, lam = Math.max(2.5, Math.min(50, 2 * Math.PI * p.sp * p.sp / 9.81));
      const hT = 0.05 * (p.L / 8) * Math.min(1, p.sp / 3.5) * (1 - 0.8 * p.pl) * Math.exp(-age / 7) * end;
      let v = (r * RIB + 0) * PV + i * 2;
      this._v(v, p.bx - rx * d * 0.92, p.bz - rz * d * 0.92, -1, T.along - p.along, 0, lam, 0, hT, 0, 0);
      this._v(v + 1, p.bx + rx * d * 0.92, p.bz + rz * d * 0.92, 1, T.along - p.along, 0, lam, 0, hT, 0, 0);
      // the wash: churned white water at the stern, breaking up; milky water under it, lingering
      const hw = Math.min(p.B * 3.5, p.B * 0.36 + age * (0.25 + 0.04 * p.sp));
      const churn = Math.min(1, p.sp / 7) * (0.55 + 0.45 * p.pl);
      const fW = Math.min(1.2, churn * (0.95 * Math.exp(-age / 1.8) + 0.35 * Math.exp(-age / 5))) * end;
      const aW = Math.min(1, p.sp / 4) * 0.9 * Math.exp(-age / 20) * Math.min(1, age * 4 + 0.3) * end;
      const hWsh = 0.05 * g6 * Math.exp(-age / 3.5) * end;
      v = (r * RIB + 1) * PV + i * 2;
      this._v(v, p.x - rx * hw, p.z - rz * hw, -1, p.along, 1, 0, fW, hWsh, aW, 0);
      this._v(v + 1, p.x + rx * hw, p.z + rz * hw, 1, p.along, 1, 0, fW, hWsh, aW, 0);
      // the arms, opening at the Kelvin angle from the bow, their crests spreading into a widening train
      const aw = Math.min(3.6, 0.6 + age * 0.22 + p.sp * 0.03), lf = Math.max(1.6, p.L * 0.55);
      const hA = 0.12 * (p.L / 8) ** 0.7 * g6 * Math.exp(-age / 11) * end;
      const fA = Math.min(1, Math.max(0, (p.sp - 3.5) / 8)) * (0.45 + 0.55 * p.pl) * Math.exp(-age / 1.7) * end;
      for (const side of [-1, 1]) {
        v = (r * RIB + (side < 0 ? 2 : 3)) * PV + i * 2;
        const di = (d - aw) * side, dout = (d + aw) * side;
        this._v(v, p.bx + rx * di, p.bz + rz * di, -1, p.along, 2, lf, fA, hA, fA * 0.35, 0);
        this._v(v + 1, p.bx + rx * dout, p.bz + rz * dout, 1, p.along, 2, lf, fA, hA, fA * 0.35, 0);
      }
    }
    // round the hull (not once it has gone: a boat out of sight leaves only its wake)
    const h0 = TRAILS * RIB * PV + r * 4, rx = fz, rz = -fx, sp = T.gone ? 0 : Math.min(1, Math.abs(b.u) / 7);
    const X = b.B * 0.5 + 2.4, Z0 = -(b.L * 0.5 + 1), Z1 = b.L * 0.5 + 2.6;
    [[-X, Z0], [X, Z0], [X, Z1], [-X, Z1]].forEach(([lx, lz], k) => this._v(h0 + k, b.x + rx * lx + fx * lz, b.z + rz * lx + fz * lz, lx, lz, 3, b.L, sp, b.planing || 0, b.B, 0));
  }
  /** Spray: off both chines at speed (the outside of a turn most), the rooster tail, mist; a burst on a slam. */
  _spray(b, T, dt, fx, fz, sp) {
    const S = this.spray, rx = fz, rz = -fx, y = b.y, fwd = b.u >= 0 ? 1 : -1, pl = b.planing || 0;
    if (sp > 3.5 && fwd > 0) {
      const base = Math.min(150, (sp - 3.5) ** 1.35 * 3.2) * (0.35 + 0.65 * pl);
      for (const side of [-1, 1]) {
        const turn = 1 + Math.max(-0.6, Math.min(1.5, -side * T.yaw * 1.6));   // (heading growing: turning to starboard, +side; the port side is outside)
        for (let n = poisson(base * turn * dt); n > 0; n--) {
          const along = b.L * (0.06 + Math.random() * 0.26), off = b.B * 0.5 * (0.7 + 0.15 * Math.random());
          const x = b.x + fx * along + rx * side * off, z = b.z + fz * along + rz * side * off;
          const out = (1.2 + sp * 0.16) * (0.6 + 0.8 * Math.random()), up = (0.8 + sp * 0.13) * (0.5 + Math.random()), fv = b.u * (0.5 + 0.3 * Math.random());
          S.drop(x, y + 0.08, z, rx * side * out + fx * fv, up, rz * side * out + fz * fv, 0.02 + Math.random() * 0.035, 1.6, y - 0.02, { ring: Math.random() < 0.05 });
        }
        if (sp > 6) for (let n = poisson((sp - 6) * 0.9 * pl * turn * dt); n > 0; n--) {
          const along = b.L * (0.05 + Math.random() * 0.2), x = b.x + fx * along + rx * side * b.B * 0.6, z = b.z + fz * along + rz * side * b.B * 0.6;
          S.mist(x, y + 0.3, z, rx * side * (0.6 + Math.random()) + fx * b.u * 0.45, 0.4, rz * side * (0.6 + Math.random()) + fz * b.u * 0.45, 0.5 + Math.random() * 0.8, 1.1 + Math.random() * 0.6, 0.16);
        }
      }
    }
    if (sp > 7 && fwd > 0) {   // the rooster tail behind the outboards
      const x0 = b.x - fx * (b.L * 0.5 + 0.35), z0 = b.z - fz * (b.L * 0.5 + 0.35);
      for (let n = poisson(Math.min(90, (sp - 7) * 7) * dt); n > 0; n--) {
        const lat = (Math.random() - 0.5) * 1.4, back = 1 + Math.random() * 2;
        S.drop(x0 + rx * lat * 0.3, y + 0.15, z0 + rz * lat * 0.3, -fx * back + fx * b.u * 0.55 + rx * lat, 2 + sp * 0.14 * Math.random(), -fz * back + fz * b.u * 0.55 + rz * lat, 0.022 + Math.random() * 0.03, 1.4, y - 0.02, { alpha: 0.5 });
      }
      for (let n = poisson((sp - 7) * 0.8 * dt); n > 0; n--) S.mist(x0, y + 0.4, z0, fx * b.u * 0.5, 0.5, fz * b.u * 0.5, 0.6 + Math.random() * 0.8, 1.2 + Math.random() * 0.6, 0.12);
    }
    // slow or still, the bow dipping into a swell: a slap — a little white water and drops thrown up, rings from it
    if (sp < 4 && (b.vy || 0) < -0.35 && GU.uTime.value - (T.slap ?? -9) > 0.6) {
      T.slap = GU.uTime.value;
      const k = Math.min(1, (-b.vy - 0.35) / 0.6), bx = b.x + fx * b.L * 0.3, bz = b.z + fz * b.L * 0.3;
      for (let n = Math.round(6 + k * 16); n > 0; n--) {
        const side = Math.random() < 0.5 ? -1 : 1, out = 0.6 + Math.random() * 1.4, up = 0.8 + Math.random() * 1.6 * (0.5 + k);
        S.drop(bx + rx * side * b.B * 0.42, y + 0.05, bz + rz * side * b.B * 0.42, rx * side * out, up, rz * side * out, 0.015 + Math.random() * 0.02, 1.4, y - 0.02, { ring: Math.random() < 0.2 });
      }
      this.marks.splash(bx, y, bz, { r: 1.5 + k * 2, life: 1.6, amp: 0.02 + k * 0.03, lam: 0.35, foam: 0.3, pfoam: 0.35 + k * 0.3, pr: b.B * 0.6, aer: 0.4, plife: 2 });
    }
    // a slam: a burst both sides of the bow, and a ring of waves out from it
    const slam = b.slam || 0;
    if (slam > T.slam + 0.08) {
      const k = slam, bx = b.x + fx * b.L * 0.2, bz = b.z + fz * b.L * 0.2;
      for (let n = Math.round(30 + k * 70); n > 0; n--) {
        const side = Math.random() < 0.5 ? -1 : 1, out = 2 + Math.random() * 3.5 + k * 3, up = 1.5 + Math.random() * 2.5 + k * 4;
        S.drop(bx + rx * side * b.B * 0.5, y + 0.1, bz + rz * side * b.B * 0.5, rx * side * out + fx * b.u * 0.45, up, rz * side * out + fz * b.u * 0.45, 0.04 + Math.random() * 0.06, 1.8, y - 0.02, { ring: Math.random() < 0.12 });
      }
      for (let n = Math.round(3 + k * 6); n > 0; n--) { const side = Math.random() < 0.5 ? -1 : 1; S.mist(bx + rx * side * b.B * 0.7, y + 0.4, bz + rz * side * b.B * 0.7, rx * side * 1.5 + fx * b.u * 0.5, 0.6, rz * side * 1.5 + fz * b.u * 0.5, 0.9 + Math.random() * 1.1, 1.4 + Math.random() * 0.6, 0.2); }
      this.marks.splash(bx, y, bz, { r: 3 + k * 5, life: 1.8, amp: 0.05 + k * 0.08, lam: 0.7, foam: 0.6, pfoam: 0.8, pr: b.B * 0.9, aer: 0.7, plife: 3 });
    }
    T.slam = slam;
  }
}
