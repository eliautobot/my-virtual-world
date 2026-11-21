// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Crowd Studio's bake detail (2026-11-19, the product owner: "a slider … to preview how much detail is lost? 0 baking
// is original quality, and then slides from there to something that can be assumed as low quality"): the resident shown
// made again by the character builder itself (client/js/builder/, opened out of sight) — its outfit as the editor makes it,
// every triangle — standing beside the crowd's own, and simplified live to the detail chosen (meshoptimizer, each part on
// its own with its borders kept, as the bake does: tools/chars/crowd-pack.mjs, custom-kind.mjs). Where the crowd's own
// levels (near, middle, far) sit on that scale: their triangles for this outfit, from its library.
import * as THREE from 'three';
import { decodeKit } from '/shared/char-kit.js';
import { BAKE_WEIGHTS, bakeFlags, bakeAttrs } from '/shared/crowd-tuning.js';

const SCALE = 0.94 / 0.5365;   // (the kit's units to metres: tools/chars/custom-kind.mjs SCALE)
const FEET = 0.85;             // (the crowd's feet: tools/chars/crowd-pack.mjs FEET)
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
let builder = null, builderHost = null, simplifier = null;

async function openHidden(gender) {
  if (!builderHost) { builderHost = Object.assign(document.createElement('div'), { style: 'position:fixed;left:-4000px;top:0;width:320px;height:420px;pointer-events:none' }); document.body.append(builderHost); }
  const { openBuilder } = await import('/js/builder/builder.js');
  if (!builder) builder = await openBuilder(builderHost, { gender });
  else await builder.setGender(gender);
  return builder;
}
// (once, ready before any call: two calls at once both wait for it)
const meshopt = () => (simplifier ??= import('/vendor/meshopt/meshopt_simplifier.js').then(async m => { await m.MeshoptSimplifier.ready; return m.MeshoptSimplifier; }));

/**
 * The editor's own make of crowd look `r` ({ head, hair, beard, top, bottom, shoes }: library indices) of body `sex`, in
 * the resident's colours `app`: the builder's selections for those parts (the library's made.picks and made.heads, as
 * crowd-pack exported them), exported as a kit. → its parts { name, role, pos (metres), nrm, col, idx }.
 */
export async function editorKit(man, sex, r, app, onStatus = () => {}) {
  const gender = sex === 'f' ? 'female' : 'male', made = man.made;
  if (!made?.picks || !made?.heads) throw new Error('this library does not say how it was made (rebuild it)');
  onStatus('Opening the character builder…');
  const B = await openHidden(gender);
  const base = { ...(B.state?.selections || {}), top: -1, bottom: -1, shoes: -1, detail: -1, ...(gender === 'male' ? { beard: -1 } : { lashes: -1 }), hair: made.picks.hair[0] };
  const sel = { ...base, ...(made.heads[r.head] || {}) };
  for (const c of ['hair', 'top', 'shoes']) if (r[c] >= 0) sel[c] = made.picks[c][r[c]];
  sel.bottom = r.bottom >= 0 ? made.picks.bottom[r.bottom] : -1;
  if (gender === 'male') sel.beard = r.beard >= 0 ? made.picks.beard[r.beard] : -1;
  const colors = { skin: app.skin, hair: app.hair, eyes: app.eyes, top: app.top, bottom: app.bottom, shoes: app.shoes, brows: null, beard: null, nose: null, ears: null };
  onStatus('Dressing it as the editor does…');
  // (dressed and exported; its body may still be loading — tried again for a few seconds, then the reason shown)
  let bytes = null, last = null;
  for (let k = 0; !bytes && k < 40; k++) {
    try {
      if (k % 10 === 0) { await B.setPreset({ format: 'mvw-character', version: 2, gender, shape: { feet: FEET }, selections: sel, colors }); await B.loadWear(); }
      ({ bytes } = B.exportKit());
    } catch (err) { last = err; await new Promise(r => setTimeout(r, 150)); }
  }
  if (!bytes) throw last || new Error('the builder made nothing');
  const kit = decodeKit(bytes);
  return kit.parts.filter(p => p.role !== 'lid').map(p => ({ name: p.name, role: p.role, pos: Float32Array.from(p.pos, x => x * SCALE), nrm: p.nrm, col: p.col, idx: Uint32Array.from(p.idx) }));
}

/** A model of the editor's parts, beside the crowd's resident: each part its own mesh, its colours per vertex. */
export function editorModel(parts) {
  const group = new THREE.Group(), meshes = [];
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  for (const p of parts) {
    const n = p.pos.length / 3, g = new THREE.BufferGeometry(), col = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) for (let q = 0; q < 3; q++) col[v * 3 + q] = lin(p.col[v * 4 + q]);
    g.setAttribute('position', new THREE.BufferAttribute(p.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(p.nrm), 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(p.idx, 1));
    const m = new THREE.Mesh(g, mat); m.userData.full = p.idx; m.userData.attrs = bakeAttrs(p.col, p.nrm, n); meshes.push(m); group.add(m);
  }
  group.userData = { meshes, mat, tris: parts.reduce((a, p) => a + p.idx.length / 3, 0) };
  return group;
}

/**
 * The model simplified as the crowd's bake simplifies a level given its error (tools/chars/crowd-pack.mjs with the
 * studio's bake; shared/crowd-tuning.js bakeFlags, BAKE_WEIGHTS): every part to the same error in metres, its colours and
 * normals weighed with its shape, so a small part (an eye, a lip, a shoe) keeps its shape as well as a large one and the
 * dense ones give up most; 0: the original, every triangle. → triangles drawn.
 */
export async function setDetail(group, err) {
  const S = await meshopt();
  let tris = 0;
  for (const m of group.userData.meshes) {
    const full = m.userData.full, pos = m.geometry.attributes.position.array;
    let idx = full;
    if (err > 0 && full.length > 36) {
      [idx] = S.simplifyWithAttributes(full, pos, 3, m.userData.attrs, 6, BAKE_WEIGHTS, null, 3, err, bakeFlags(err));
      if (idx.length < 3) idx = full.subarray(0, 0);
    }
    m.geometry.setIndex(new THREE.BufferAttribute(idx instanceof Uint32Array ? idx : Uint32Array.from(idx), 1));
    tris += idx.length / 3;
  }
  return tris;
}
/** The error that leaves about `want` triangles (searched, as the bake searches its budget). → { err, tris } */
export async function detailFor(group, want) {
  let lo = -5, hi = -0.7, best = { err: 0, tris: group.userData.tris };
  for (let k = 0; k < 14; k++) {
    const mid = (lo + hi) / 2, t = await setDetail(group, 10 ** mid);
    if (Math.abs(t - want) < Math.abs(best.tris - want)) best = { err: 10 ** mid, tris: t };
    if (t > want) lo = mid; else hi = mid;
  }
  await setDetail(group, best.err);
  return best;
}

/** This outfit's triangles in the crowd's library at each level (0 near, 1 middle, 2 far: the far look-alikes'). */
export function crowdTris(man, r) {
  const out = [0, 1, 2].map(L => {
    let t = man.parts.body[0].lods[L].tris;
    for (const c of ['head', 'hair', 'beard', 'top', 'bottom', 'shoes']) {
      if (!(r[c] >= 0)) continue;
      const p = man.parts[c][L ? man.parts[c][r[c]].far?.[L] ?? r[c] : r[c]];
      t += p?.lods[L]?.tris || 0;
    }
    return t;
  });
  // (its close-up level, when the library has one)
  if (man.parts.body[0].close) { let t = man.parts.body[0].close.tris; for (const c of ['head', 'hair', 'beard', 'top', 'bottom', 'shoes']) if (r[c] >= 0) t += man.parts[c][r[c]]?.close?.tris || 0; out.c = t; }
  return out;
}
