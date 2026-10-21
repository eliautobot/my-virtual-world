// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The player stream (PLAN WP1.10, I14.11): one binary frame per browser per tick, holding only the players in its area
// of interest that changed since it last heard of them. Resident plans are frame type 1 (shared/proto.js); this is 2.
// Header 12 B: u8 type (2) | u8 0 | u16 count | f64 server time (ms)
// Entry  24 B: u32 player id | f32 x y z | i16 yaw*1e4 | u16 ctx+2 | u8 clip | u8 flags | u16 seq
export const MSG_PLAYERS = 2;
export const PF_OBSERVING = 1;   // the person is looking from the overview or editor camera; the character waits
export const PF_USING = 2;       // seated or using something (the body may sit on furniture)
export const PF_DRIVING = 4;     // server-confirmed driver; avatar is presented inside the vehicle
export const PF_YOU = 64;        // this is the recipient's own player (seen from another tab or while observing)
export const PF_OUT = 128;       // left this browser's area of interest (or the world): drop it
const HDR = 12, ENTRY = 24;

export const playerFrameBytes = n => HDR + n * ENTRY;

/** list: [{ pid, x, y, z, yaw, ctx, clip, flags, seq }] → ArrayBuffer */
export function encodePlayers(list, t) {
  const buf = new ArrayBuffer(playerFrameBytes(list.length)), dv = new DataView(buf);
  dv.setUint8(0, MSG_PLAYERS); dv.setUint8(1, 0); dv.setUint16(2, list.length, true); dv.setFloat64(4, t, true);
  let o = HDR;
  for (const p of list) {
    dv.setUint32(o, p.pid, true);
    dv.setFloat32(o + 4, p.x, true); dv.setFloat32(o + 8, p.y, true); dv.setFloat32(o + 12, p.z, true);
    let yaw = p.yaw % (Math.PI * 2);
    if (yaw > Math.PI) yaw -= Math.PI * 2; else if (yaw < -Math.PI) yaw += Math.PI * 2;
    dv.setInt16(o + 16, Math.round(yaw * 10000), true);
    dv.setUint16(o + 18, Math.max(0, Math.min(65535, (p.ctx | 0) + 2)), true);
    dv.setUint8(o + 20, p.clip & 255); dv.setUint8(o + 21, p.flags & 255);
    dv.setUint16(o + 22, p.seq & 65535, true);
    o += ENTRY;
  }
  return buf;
}
/** Calls cb(entry, serverTime) for each player in a frame; returns how many (0 for another frame type). */
export function decodePlayers(buf, cb) {
  const dv = buf instanceof DataView ? buf : new DataView(buf);
  if (dv.byteLength < HDR || dv.getUint8(0) !== MSG_PLAYERS) return 0;
  const n = dv.getUint16(2, true), t = dv.getFloat64(4, true);
  if (dv.byteLength < playerFrameBytes(n)) return 0;
  let o = HDR;
  for (let k = 0; k < n; k++) {
    cb({
      pid: dv.getUint32(o, true), x: dv.getFloat32(o + 4, true), y: dv.getFloat32(o + 8, true), z: dv.getFloat32(o + 12, true),
      yaw: dv.getInt16(o + 16, true) / 10000, ctx: dv.getUint16(o + 18, true) - 2, clip: dv.getUint8(o + 20), flags: dv.getUint8(o + 21),
      seq: dv.getUint16(o + 22, true),
    }, t);
    o += ENTRY;
  }
  return n;
}
