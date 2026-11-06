// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Amazon furniture's models (Amazon Berkeley Objects, CC BY 4.0: /assets/abo/ATTRIBUTION.md; shared/abo-items.js,
// shared/abo-replace.js): each loaded once (KTX2 maps, meshopt geometry: tools/abo-build.mjs), kept while a floor or a
// park shows it and a little after, its materials lit like the rest of the furniture (render/mats.js: the street lamps
// at night, the indoor light). Interiors draws the pieces with them: one instanced mesh per model part, per floor.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CATALOG } from '/shared/catalog.js';
import { aboParts } from '/shared/abo-replace.js';
import { aboId, ABO_PREFIX } from '/shared/abo-items.js';
import { commonUniforms, WP_VERT, FRAG_PARS } from './mats.js';
import { onFile } from './surface-items.js';
import { dressContext, dressPools, floorSeed } from '/shared/dress.js';

const BASE = '/assets/abo/m/';
const KEEP_MS = 45000;   // a model no floor shows any more is let go after this
let loader = null, ktx2 = null;
const models = new Map();   // id -> { state: 'loading' | 'ready' | 'failed', prims: [{ geo, mat }], refs, waiters, drop }

/** Ready the loaders for the renderer (its texture formats). */
export function aboInit(renderer) {
  if (loader) return;
  ktx2 = new KTX2Loader().setTranscoderPath('/vendor/three/examples/jsm/libs/basis/').detectSupport(renderer);
  loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
}

function furnish(src, flat) {   // the model's material, lit like render/mats.js makeFurnMat({ lit, indoor })
  const m = src.clone();
  m.onBeforeCompile = (sh) => {
    commonUniforms(sh);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WP_VERT}`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.8, 0.55) * lampLight(vWP) * uNight * 1.6;
totalEmissiveRadiance += diffuseColor.rgb * uIndoor;`);
  };
  m.customProgramCacheKey = () => 'mvw-abo';
  if (flat) Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });   // (a rug over the floor's finish)
  return m;
}

/** The model of Amazon id (loading it the first time): its record; done(rec) is called once it has loaded. */
export function aboModel(id, done) {
  return modelAt(id, BASE + id + '.glb', () => (CATALOG[ABO_PREFIX + id]?.h ?? 1) <= 0.05, done);
}
/** A goods model by its file (shared/goods-items.js goodsFiles; a library piece's dressing copy): as aboModel, held and
 *  let go by its file (aboHold, aboRelease). */
export function goodsModel(url, done) { return modelAt(url, url, () => false, done); }
function modelAt(key, url, isFlat, done) {
  let r = models.get(key);
  if (!r) {
    r = { id: key, state: 'loading', prims: [], refs: 0, waiters: new Set(), drop: 0 };
    models.set(key, r);
    if (!loader) { r.state = 'failed'; return r; }
    loader.load(url, (g) => {
      const flat = isFlat();
      g.scene.updateMatrixWorld(true);
      g.scene.traverse(o => {
        if (!o.isMesh) return;
        // (its geometry as stored, quantized: its node's matrix, in the model's own frame, goes into each instance's)
        o.geometry.computeBoundingSphere();
        r.prims.push({ geo: o.geometry, local: o.matrixWorld.clone(), mat: furnish(o.material, flat) });
      });
      r.state = 'ready';
      for (const f of r.waiters) f(r);
      r.waiters.clear();
    }, undefined, () => { r.state = 'failed'; for (const f of r.waiters) f(r); r.waiters.clear(); });
  }
  if (done && r.state === 'loading') r.waiters.add(done);
  return r;
}
/** After the world has loaded: the models its placed pieces use, fetched and readied in the background (the most used
 *  first, two at a time, when the page is idle), so a floor looked inside draws its Amazon furniture at once. A slow link
 *  took ~3 s on the first floor (the KTX2 transcoder, then each model) and ~1 s on a floor with many models. */
export function aboPrefetch(world, delay = 1500, then = null) {
  const n = new Map();
  for (const L of world.levels || []) for (const it of L?.items || []) {
    const look = aboLook(it.t, it); if (!look) continue;
    for (const p of look.parts) n.set(p.id, (n.get(p.id) || 0) + 1);
  }
  const queue = [...n].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const idle = window.requestIdleCallback ? f => window.requestIdleCallback(f, { timeout: 2000 }) : f => setTimeout(f, 50);
  let active = 0;
  const next = () => {
    while (active < 2 && queue.length) {
      const id = queue.shift(); if (models.has(id)) continue;
      active++;
      idle(() => { const r = aboModel(id, () => { active--; next(); }); if (r.state !== 'loading') { active--; next(); } });
    }
    if (!active && !queue.length && then) { const f = then; then = null; f(); }   // (all readied: what comes next)
  };
  setTimeout(next, delay);
  return queue.length;
}
/** The dressing's light models (shared/dress.js) the world's floors draw from, most used first, readied in the background
 *  two at a time when the browser is idle (after the Amazon furniture's: aboPrefetch). At most max files (~20 KB each). */
export function dressPrefetch(world, q = 'high', max = 240) {
  const idle = window.requestIdleCallback ? f => window.requestIdleCallback(f, { timeout: 2000 }) : f => setTimeout(f, 50);
  const floors = [];
  for (const B of world.buildings || []) if (B && !B.gone) (B.lv || []).forEach((lv, f) => { const L = world.levels?.[lv]; if (L) floors.push([B, f, L]); });
  const n = new Map();
  let k = 0, active = 0, queue = null;
  const load = () => {
    while (active < 2 && queue.length) {
      const file = queue.shift(); if (models.has(file)) continue;
      active++;
      idle(() => { const r = goodsModel(file, () => { active--; load(); }); if (r.state !== 'loading') { active--; load(); } });
    }
  };
  const count = () => {   // (the floors' pools, 60 floors at a time)
    for (const end = Math.min(floors.length, k + 60); k < end; k++) {
      const [B, f, L] = floors[k], ctx = dressContext(B, f, L); if (!ctx) continue;
      for (const ts of Object.values(dressPools(ctx, floorSeed(B, f, L), q))) for (const t of ts) { const file = onFile(t, 'd'); if (file) n.set(file, (n.get(file) || 0) + 1); }
    }
    if (k < floors.length) { idle(count); return; }
    queue = [...n].sort((a, b) => b[1] - a[1]).slice(0, max).map(([file]) => file);
    load();
  };
  idle(count);
}
/** A floor or park drawing model id (an Amazon id, or a goods model's file) holds it (released with aboRelease). */
export function aboHold(id) { const r = id.startsWith('/') ? goodsModel(id) : aboModel(id); r.refs++; clearTimeout(r.drop); return r; }
export function aboRelease(id) {
  const r = models.get(id); if (!r) return;
  r.refs = Math.max(0, r.refs - 1);
  if (r.refs) return;
  clearTimeout(r.drop);
  r.drop = setTimeout(() => {   // let go: its geometry, its materials and their maps
    if (r.refs || models.get(id) !== r || r.state === 'loading') return;
    for (const p of r.prims) {
      p.geo.dispose();
      for (const v of Object.values(p.mat)) if (v && v.isTexture) v.dispose();
      p.mat.dispose();
    }
    models.delete(id);
  }, KEEP_MS);
}

/** on: false draws every piece as MVW's own (a comparison in the lab: the view's cost with and without the models). */
export const ABO = { on: true };
/** What a placed piece is drawn with when it is drawn with Amazon models: { parts, props } (shared/abo-replace.js), or null. */
export function aboLook(t, it) {
  if (!ABO.on && !t.startsWith(ABO_PREFIX)) return null;
  const m = t.startsWith(ABO_PREFIX) ? t : it?.m;
  return m ? aboParts(t, m) : null;
}
const _pm = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
/** A part's matrix in its piece's frame: scaled, turned, moved (shared/abo-replace.js aboParts). */
export function partMatrix(part, out = new THREE.Matrix4()) {
  _q.setFromAxisAngle(_up, part.yaw || 0);
  return out.compose(_p.set(...part.p), _q, _s.set(...part.s));
}

/** The ghost of a piece while it is being placed or moved: the model (or its box until it has loaded: done(geo) then);
 *  m: an MVW piece's model choice (it is dragged looking as it is drawn). */
export function aboGhost(t, done, m = null) {
  const L = aboLook(t, m ? { m } : null); if (!L) return null;
  const geos = [], wait = new Set();
  for (const part of L.parts) {
    const r = aboModel(part.id, () => { wait.delete(part.id); if (!wait.size) done?.(aboGhost(t, null, m)); });
    if (r.state === 'loading') { wait.add(part.id); continue; }
    for (const p of r.prims) geos.push(stripped(p.geo).applyMatrix4(partMatrix(part, _pm).multiply(p.local)));
  }
  if (wait.size || !geos.length) {
    const d = CATALOG[t], [x0, z0, x1, z1] = d.rect, lift = d.lift || 0;
    return new THREE.BoxGeometry(x1 - x0, Math.max(0.02, d.h - lift), z1 - z0).translate((x0 + x1) / 2, lift + (d.h - lift) / 2, (z0 + z1) / 2);
  }
  return geos.length === 1 ? geos[0] : mergeGeometries(geos, false) || geos[0];
}
/** The ghost of a thing put on a piece (or a goods item on the floor): its drawn model (render/surface-items.js onFile, the
 *  lean one) with a library piece's own scale and raise, or its box until it has loaded (done(geo) then). */
export function goodsGhost(t, done) {
  const d = CATALOG[t], file = onFile(t, 'm'); if (!d || !file) return null;
  const r = goodsModel(file, () => done?.(goodsGhost(t, null)));
  const lib = !!d.abo && !d.goods, k = lib ? d.scale || 1 : 1, M = new THREE.Matrix4().makeScale(k, k, k).setPosition(0, lib ? d.oy || 0 : 0, 0);
  if (r.state === 'ready' && r.prims.length) {
    const geos = r.prims.map(p => stripped(p.geo).applyMatrix4(_pm.multiplyMatrices(M, p.local)));
    return geos.length === 1 ? geos[0] : mergeGeometries(geos, false) || geos[0];
  }
  const [x0, z0, x1, z1] = d.rect, lift = d.lift || 0;
  return new THREE.BoxGeometry(x1 - x0, Math.max(0.02, d.h - lift), z1 - z0).translate((x0 + x1) / 2, lift + (d.h - lift) / 2, (z0 + z1) / 2);
}
function stripped(g) {   // position + normal only, as floats (the ghost's own material; parts merge, matrices apply)
  const o = new THREE.BufferGeometry();
  for (const k of ['position', 'normal']) {
    const a = g.attributes[k]; if (!a) continue;
    const f = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) { f[i * 3] = a.getX(i); f[i * 3 + 1] = a.getY(i); f[i * 3 + 2] = a.getZ(i); }
    o.setAttribute(k, new THREE.BufferAttribute(f, 3));
  }
  if (g.index) o.setIndex(g.index.clone());
  return o.index ? o.toNonIndexed() : o;
}
export { aboId };
