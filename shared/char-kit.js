// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A built character's kit: the character assembled in the builder (client/js/builder/export.js), in its bind pose, as the
// browser sends it to be baked (server/characters/, tools/chars/custom-kind.mjs). Shared, so both read and write it alike.
//
// Binary: [u32 header length][header JSON][pad to 4][sections]. Header = { v, gender, joints: [x, y, z × 65, in the rig's
// order], parts: [{ name, role, verts, tris, at: { pos, nrm, uv?, col, j, w, idx, lid? } (byte offsets into the sections) }],
// preset }. pos/nrm float32 ×3, uv float32 ×2, col uint8 ×4 (sRGB; a = 255 where the base body's normal map applies), j
// uint8 ×4 (bones), w uint8 ×4 (weights out of 255), idx uint32 ×3 per triangle, lid float32 (a closed eyelid's vertex:
// where it is with the eye open, its height; −1 for any other), rm uint8 ×2 (optional: the material's roughness and
// metalness out of 255 — 2026-11-19, a shoe's leather and a button's metal catch the light in the city as in the builder) —
// all in the builder's units (a body about 1 tall).
export const KIT_VERSION = 1;
export const KIT_LIMITS = Object.freeze({ bytes: 24 << 20, parts: 96, verts: 300000, tris: 500000, partVerts: 200000, partTris: 400000 });

/** The kit as bytes (Uint8Array). kit = { gender, joints (65×3), parts: [{ name, role, pos, nrm, uv?, col, j, w, idx, lid? }], preset }. */
export function encodeKit(kit) {
  const secs = [], parts = [];
  let off = 0;
  const put = arr => {
    if (!arr) return undefined;
    const a = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), at = off;
    secs.push(a); off += a.byteLength;
    const pad = (4 - (off % 4)) % 4; if (pad) { secs.push(new Uint8Array(pad)); off += pad; }
    return at;
  };
  for (const p of kit.parts) parts.push({ name: p.name, role: p.role, verts: p.pos.length / 3, tris: p.idx.length / 3, at: { pos: put(p.pos), nrm: put(p.nrm), uv: put(p.uv), col: put(p.col), j: put(p.j), w: put(p.w), idx: put(p.idx), lid: put(p.lid), rm: put(p.rm) } });
  const head = new TextEncoder().encode(JSON.stringify({ v: KIT_VERSION, gender: kit.gender, joints: Array.from(kit.joints), parts, preset: kit.preset ?? null }));
  const pre = 4 + head.length, pad = (4 - (pre % 4)) % 4, out = new Uint8Array(pre + pad + off);
  new DataView(out.buffer).setUint32(0, head.length, true); out.set(head, 4);
  let at = pre + pad; for (const s of secs) { out.set(s, at); at += s.byteLength; }
  return out;
}

/** Reads a kit's bytes, checking every count, offset and value it will use (it comes from a browser). Throws on any fault. */
export function decodeKit(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.byteLength < 8 || u8.byteLength > KIT_LIMITS.bytes) throw new Error('kit: size');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), hl = dv.getUint32(0, true);
  if (hl > 1 << 20 || 4 + hl > u8.byteLength) throw new Error('kit: header');
  let head;
  try { head = JSON.parse(new TextDecoder().decode(u8.subarray(4, 4 + hl))); } catch { throw new Error('kit: header'); }
  // (copied out: a Node Buffer's slice shares its pool, and the sections are read as typed arrays from offset 0)
  const base = 4 + hl + ((4 - ((4 + hl) % 4)) % 4), body = new Uint8Array(Math.max(0, u8.byteLength - base)), ab = body.buffer;
  body.set(u8.subarray(base));
  if (head?.v !== KIT_VERSION) throw new Error('kit: unknown version');
  if (head.gender !== 'male' && head.gender !== 'female') throw new Error('kit: no sex');
  if (!Array.isArray(head.joints) || head.joints.length !== 65 * 3 || !head.joints.every(v => Number.isFinite(v) && Math.abs(v) < 4)) throw new Error('kit: joints');
  if (!Array.isArray(head.parts) || !head.parts.length || head.parts.length > KIT_LIMITS.parts) throw new Error('kit: parts');
  let verts = 0, tris = 0;
  const parts = head.parts.map(p => {
    const n = p?.verts | 0, t = p?.tris | 0, at = p?.at || {};
    if (!(n > 0 && n <= KIT_LIMITS.partVerts && t > 0 && t <= KIT_LIMITS.partTris)) throw new Error('kit: part size');
    verts += n; tris += t;
    const view = (T, o, count) => {
      if (o == null) return null;
      if (!Number.isInteger(o) || o % T.BYTES_PER_ELEMENT || o < 0 || o + count * T.BYTES_PER_ELEMENT > ab.byteLength) throw new Error('kit: section');
      return new T(ab, o, count);
    };
    const out = { name: String(p.name || '').slice(0, 80), role: String(p.role || 'part').slice(0, 16), pos: view(Float32Array, at.pos, n * 3), nrm: view(Float32Array, at.nrm, n * 3), uv: view(Float32Array, at.uv, n * 2),
      col: view(Uint8Array, at.col, n * 4), j: view(Uint8Array, at.j, n * 4), w: view(Uint8Array, at.w, n * 4), idx: view(Uint32Array, at.idx, t * 3), lid: view(Float32Array, at.lid, n), rm: view(Uint8Array, at.rm, n * 2) };
    if (!out.pos || !out.nrm || !out.col || !out.j || !out.w || !out.idx) throw new Error('kit: part missing data');
    for (let i = 0; i < out.idx.length; i++) if (out.idx[i] >= n) throw new Error('kit: index out of range');
    for (let i = 0; i < out.j.length; i++) if (out.j[i] >= 65) throw new Error('kit: bone out of range');
    for (const a of [out.pos, out.nrm, out.uv, out.lid]) if (a) for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i]) || Math.abs(a[i]) > 4) throw new Error('kit: value out of range');
    return out;
  });
  if (verts > KIT_LIMITS.verts || tris > KIT_LIMITS.tris) throw new Error('kit: too big');
  return { v: head.v, gender: head.gender, joints: head.joints, parts, preset: head.preset && typeof head.preset === 'object' ? head.preset : null };
}
