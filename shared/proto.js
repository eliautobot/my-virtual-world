// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Motion-plan wire format. The server sends each agent's plan once (piecewise-linear segments, absolute sim time);
// every client evaluates positions locally each frame, so bandwidth scales with plan changes, not with frame rate.
// Plan header 28 B: u32 idx | f64 base | f32 sx sy sz | u16 n | u16 dest ctx + 2
// Segment   24 B: f32 dur | f32 x y z (end point) | i16 yaw*1e4 | u16 ctx+2 | u8 anim | u8 prop|flags<<4 | u8 use | u8 veh
// veh (WP4.9/4.15): what carries a hidden traveller — 0 nothing drawn (a lift, the subway), VEH_CAR, VEH_BOAT. On a visible
// segment the same byte is the food or drink item they have (shared/food.js number; 0 none): on their table, in their hand.
import { normAngle } from './geom.js';

export const F_HIDDEN = 1;    // not drawn (inside an elevator car / underground)
export const F_FACE = 2;      // keep `yaw` while translating (sliding into a seat, side steps)
export const F_TRAVEL = 4;    // travelling toward the activity in `use`
export const F_SNAP = 8;      // no animation cross-fade into this segment
export const CTX_UNDER = -2, CTX_OUT = -1;
export const VEH_CAR = 1, VEH_BOAT = 2;
export const MSG_PLANS = 1;
const HDR = 28, SEGB = 24;

export const planBytes = n => HDR + n * SEGB;

export function writePlan(dv, o, idx, p) {
  const n = p.segs.length;
  dv.setUint32(o, idx, true); dv.setFloat64(o + 4, p.base, true);
  dv.setFloat32(o + 12, p.sx, true); dv.setFloat32(o + 16, p.sy, true); dv.setFloat32(o + 20, p.sz, true);
  dv.setUint16(o + 24, n, true);
  const dest = p.meta && p.meta.dest !== undefined ? p.meta.dest : -1;
  dv.setUint16(o + 26, dest + 2, true);
  o += HDR;
  for (let k = 0; k < n; k++) {
    const s = p.segs[k];
    dv.setFloat32(o, s.dur, true); dv.setFloat32(o + 4, s.x, true); dv.setFloat32(o + 8, s.y, true); dv.setFloat32(o + 12, s.z, true);
    dv.setInt16(o + 16, Math.round(normAngle(s.yaw) * 10000), true);
    dv.setUint16(o + 18, s.ctx + 2, true);
    dv.setUint8(o + 20, s.anim); dv.setUint8(o + 21, (s.prop & 15) | ((s.flags & 15) << 4));
    dv.setUint8(o + 22, s.use); dv.setUint8(o + 23, s.veh || 0);
    o += SEGB;
  }
  return o;
}
/** list: [[idx, plan], ...] -> ArrayBuffer */
export function encodePlans(list) {
  let size = 4;
  for (const e of list) size += planBytes(e[1].segs.length);
  const buf = new ArrayBuffer(size), dv = new DataView(buf);
  dv.setUint8(0, MSG_PLANS); dv.setUint8(1, 0); dv.setUint16(2, list.length, true);
  let o = 4;
  for (const e of list) o = writePlan(dv, o, e[0], e[1]);
  return buf;
}
/** Decode into typed-array plans: cb(idx, plan). */
export function decodePlans(buf, cb) {
  const dv = buf instanceof DataView ? buf : new DataView(buf);
  if (dv.getUint8(0) !== MSG_PLANS) return 0;
  const count = dv.getUint16(2, true);
  let o = 4;
  for (let c = 0; c < count; c++) {
    const idx = dv.getUint32(o, true), base = dv.getFloat64(o + 4, true);
    const sx = dv.getFloat32(o + 12, true), sy = dv.getFloat32(o + 16, true), sz = dv.getFloat32(o + 20, true);
    const n = dv.getUint16(o + 24, true), dest = dv.getUint16(o + 26, true) - 2;
    o += HDR;
    const p = { base, sx, sy, sz, n, dest, t0: new Float64Array(n + 1), d0: new Float32Array(n + 1),
      x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), yaw: new Float32Array(n),
      ctx: new Int32Array(n), anim: new Uint8Array(n), prop: new Uint8Array(n), flags: new Uint8Array(n), use: new Uint8Array(n), veh: new Uint8Array(n), end: base };
    let acc = 0, dist = 0, px = sx, pz = sz;
    for (let k = 0; k < n; k++) {
      p.t0[k] = acc; p.d0[k] = dist;
      acc += dv.getFloat32(o, true);
      const x = dv.getFloat32(o + 4, true), z = dv.getFloat32(o + 12, true);
      p.x[k] = x; p.y[k] = dv.getFloat32(o + 8, true); p.z[k] = z;
      dist += Math.hypot(x - px, z - pz); px = x; pz = z;
      p.yaw[k] = dv.getInt16(o + 16, true) / 10000;
      p.ctx[k] = dv.getUint16(o + 18, true) - 2;
      p.anim[k] = dv.getUint8(o + 20);
      const pf = dv.getUint8(o + 21); p.prop[k] = pf & 15; p.flags[k] = pf >> 4;
      p.use[k] = dv.getUint8(o + 22); p.veh[k] = dv.getUint8(o + 23);
      o += SEGB;
    }
    p.t0[n] = acc; p.d0[n] = dist; p.end = base + acc;
    cb(idx, p);
  }
  return count;
}
/** Position of a decoded plan at sim time t (binary search over segment start times). Every client runs this per
 *  resident per frame; it must agree with the server's evalPlan (server/sim/plan.js). */
export function evalDecoded(p, t, out = {}) {
  const rel = t - p.base, n = p.n, T = p.t0;
  if (rel <= 0 || n === 0) { out.k = 0; out.u = 0; out.x = p.sx; out.y = p.sy; out.z = p.sz; return out; }
  if (rel >= T[n]) { const k = n - 1; out.k = k; out.u = 1; out.x = p.x[k]; out.y = p.y[k]; out.z = p.z[k]; return out; }
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (T[mid] <= rel) lo = mid; else hi = mid - 1; }
  const k = lo, dur = T[k + 1] - T[k], u = dur > 1e-6 ? (rel - T[k]) / dur : 1;
  const ax = k ? p.x[k - 1] : p.sx, ay = k ? p.y[k - 1] : p.sy, az = k ? p.z[k - 1] : p.sz;
  out.k = k; out.u = u; out.x = ax + (p.x[k] - ax) * u; out.y = ay + (p.y[k] - ay) * u; out.z = az + (p.z[k] - az) * u;
  return out;
}
