// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The things on pieces (shared/surfaces.js `on`: goods, small decor) as they are drawn on the focused floor and in the parks
// (render/interiors.js addOn: one instanced mesh per model part, never casting a shadow): which file each is drawn with,
// the lean model on high quality and its light dressing copy (<= 400 triangles) otherwise (PLAN-SURFACES.md 0.8, 9), and
// where, carried by its piece (its place in the piece's own frame, on the surface's height).
import * as THREE from 'three';
import { CATALOG } from '/shared/catalog.js';
import { goodsFiles, ABO_DRESS } from '/shared/goods-items.js';
import { surfacesOf } from '/shared/surfaces.js';

/** lod: 'm' the lean model, 'd' the dressing copy (main.js sets it by the quality chosen). */
export const GOODS = { lod: 'm' };
/** The dressing (shared/dress.js: what a piece with no list of its own holds by itself) as drawn: on (off: none drawn),
 *  q the quality whose rules and budgets it keeps to (main.js). Always drawn with the light copies. */
export const DRESS = { on: true, q: 'high' };
/** The things drawn on host entry e: its own list, else its dressing when it is drawn (render/interiors.js e.gen,
 *  e.genShow: within the floor's budget), else null. */
export function shownOn(e) {
  const on = e?.it?.on;
  if (Array.isArray(on)) return on;
  return e?.genShow && e.gen ? e.gen.list : null;
}

/** The file a thing of type t is drawn with, or null. */
export function onFile(t, lod = GOODS.lod) {
  const f = goodsFiles(t); if (f) return f[lod];
  const d = CATALOG[t];
  if (d?.abo && d.onOk) return lod === 'd' && ABO_DRESS.has(d.abo) ? `/assets/abo/d/${d.abo}.glb` : `/assets/abo/m/${d.abo}.glb`;
  return null;
}

const _host = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
/** A thing's matrix in the frame it stands in (its piece's, or the floor's): the model's own scale and raise for a library
 *  piece (shared/abo-replace.js), at height y. */
function thingMatrix(t, x, y, z, r) {
  const d = CATALOG[t], lib = !!d.abo && !d.goods, k = lib ? d.scale || 1 : 1;
  return new THREE.Matrix4().compose(_p.set(x, y + (lib ? d.oy || 0 : 0), z), _q.setFromAxisAngle(_up, r || 0), _s.set(k, k, k));
}
/** The things on host entry e (Interiors.entry: its place x y z, yaw, and its record it): [{ file, m, i }], m the thing's
 *  matrix in the world (the model's own node matrix still to apply), i its index in the piece's list. Entries on a surface
 *  the piece no longer has are skipped (the server takes them off at its next boot). A goods item standing on the floor
 *  itself (floor-ok goods: a backpack, a plant pot) is drawn the same way (i: -1). */
export function onPlaced(e, lod = GOODS.lod) {
  const d0 = CATALOG[e.t];
  if (d0?.goods) { const file = onFile(e.t, lod); return file ? [{ file, m: thingMatrix(e.t, 0, 0, 0, 0).premultiply(hostMatrix(e)), i: -1 }] : []; }
  const list = shownOn(e), own = Array.isArray(e.it?.on);
  if (!list?.length) return [];
  const S = surfacesOf(e.it), out = [], H = hostMatrix(e);
  list.forEach((o, i) => {
    const s = S[o.s], file = CATALOG[o.t] && onFile(o.t, own ? lod : 'd');   // (its dressing: the light copies)
    if (!s || !file) return;
    out.push({ file, m: thingMatrix(o.t, o.x, s.y, o.z, o.r).premultiply(H), i });
  });
  return out;
}
function hostMatrix(e, out = _host) { return out.compose(_p.set(e.x, e.y, e.z), _q.setFromAxisAngle(_up, e.yaw), _s.set(1, 1, 1)); }
/** Where thing o ({ t, s, x, z, r }) of host entry e stands in the world: { x, y, z, yaw }, or null (no such surface). */
export function onPose(e, o) {
  const S = surfacesOf(e.it)[o.s]; if (!S) return null;
  const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
  return { x: e.x + o.x * c + o.z * s, y: e.y + S.y, z: e.z - o.x * s + o.z * c, yaw: e.yaw + (o.r || 0) };
}
/** A ray (world) in host entry e's own frame: [origin, direction] as arrays. */
export function rayInto(e, ray, y = e.y) {
  const c = Math.cos(e.yaw), s = Math.sin(e.yaw), ox = ray.origin.x - e.x, oz = ray.origin.z - e.z, dx = ray.direction.x, dz = ray.direction.z;
  return [[ox * c - oz * s, ray.origin.y - y, ox * s + oz * c], [dx * c - dz * s, ray.direction.y, dx * s + dz * c]];
}
