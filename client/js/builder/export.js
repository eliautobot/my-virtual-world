// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The character on the builder's stage as a kit to bake (shared/char-kit.js; the server makes a city model of it,
// tools/chars/custom-kind.mjs): every visible part in its bind pose — the body as the proportions shaped it, the face,
// hair and clothes — with its skin weights on the city's 65-bone rig and its colours per vertex.
// - Colours: each triangle's material colour times its vertex colours (sRGB bytes). Alpha marks the base body's skin
//   below the neck, where its normal map's detail applies (the face is sculpted: its own normals).
// - Eyes at rest: open, looking ahead, the pupils as set. Each eyelid and lash is also sent closed (role 'lid'),
//   with each vertex's open height: the city shows it only while blinking or asleep, sliding from open to closed.
// - Skin hidden under clothes stays out (the builder drops those triangles); unused vertices are left out.
// - A printed cloth (the Tripo collection's tartan, sprigs, knit: a texture) gives each vertex the print's colour there,
//   seen at the mesh's own fineness (the print averaged over about a triangle's width), as the city colours per vertex.
import * as THREE from 'three';
import { encodeKit } from '/shared/char-kit.js';
import { eyeMorphWeights } from './eye-pose.js';

const BONES = ['Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'LeftToe_End', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase', 'RightToe_End', 'Spine', 'Spine1', 'Spine2',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', ...['Index', 'Middle', 'Pinky', 'Ring', 'Thumb'].flatMap(f => [1, 2, 3, 4].map(i => `LeftHand${f}${i}`)), 'Neck', 'Head', 'HeadTop_End',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', ...['Index', 'Middle', 'Pinky', 'Ring', 'Thumb'].flatMap(f => [1, 2, 3, 4].map(i => `RightHand${f}${i}`))];
const short = n => n.replace(/^mixamorig[:_]?/i, '');
/** Parts that close over the eye in a blink (their 'Blink' shape): sent a second time, closed. */
const CLOSES = /upper lid|lower lid|lash line|lash flick|^Lashes \/|graphic upper liner|graphic wing/;
const _c = new THREE.Color(), IDENT = new THREE.Matrix4();
const toByte = v => Math.max(0, Math.min(255, Math.round(v * 255)));
const srgb = v => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

const linear = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const prints = new WeakMap();
/** A print's levels of detail (linear RGB, box-averaged): [{ n, rgb: Float32Array }], finest first. */
function printLevels(tex) {
  let L = prints.get(tex);
  if (L) return L;
  const img = tex.image, n0 = img?.width, d = img?.data;
  if (!d || !n0 || img.height !== n0) return null;
  const srgbTex = tex.colorSpace === 'srgb', rgb = new Float32Array(n0 * n0 * 3);
  for (let i = 0; i < n0 * n0; i++) for (let q = 0; q < 3; q++) { const v = d[i * 4 + q] / 255; rgb[i * 3 + q] = srgbTex ? linear(v) : v; }
  L = [{ n: n0, rgb }];
  for (let n = n0 >> 1; n >= 1; n >>= 1) {
    const up = L[L.length - 1], o = new Float32Array(n * n * 3);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let q = 0; q < 3; q++) {
      const a = (yy, xx) => up.rgb[((yy) * up.n + xx) * 3 + q];
      o[(y * n + x) * 3 + q] = (a(2 * y, 2 * x) + a(2 * y, 2 * x + 1) + a(2 * y + 1, 2 * x) + a(2 * y + 1, 2 * x + 1)) / 4;
    }
    L.push({ n, rgb: o });
  }
  prints.set(tex, L);
  return L;
}
/** The print's colour at (u, v) on level lv, bilinear, repeating. */
function printAt(lv, u, v, out) {
  const n = lv.n, x = ((u * n - 0.5) % n + n) % n, y = ((v * n - 0.5) % n + n) % n, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
  for (let q = 0; q < 3; q++) {
    const a = lv.rgb[(y0 * n + x0) * 3 + q], b = lv.rgb[(y0 * n + x1) * 3 + q], c = lv.rgb[(y1 * n + x0) * 3 + q], d = lv.rgb[(y1 * n + x1) * 3 + q];
    out[q] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  return out;
}
/** The level matching a mesh's fineness: its triangles' median edge in the print's terms, about one texel. */
function printLevel(levels, g, index, groups) {
  const UV = g.attributes.uv, e = [];
  for (const gr of groups) for (let t = gr.start; t + 2 < gr.start + gr.count && e.length < 4000; t += 3 * 7) {
    const a = index ? index.getX(t) : t, b = index ? index.getX(t + 1) : t + 1;
    e.push(Math.hypot(UV.getX(a) - UV.getX(b), UV.getY(a) - UV.getY(b)));
  }
  e.sort((a, b) => a - b);
  const edge = e[e.length >> 1] || 1 / levels[0].n;
  let k = 0; while (k < levels.length - 1 && levels[k].n * edge > 1.5) k++;
  return levels[k];
}

function visible(o) { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; }

/** A mesh's positions and normals with its morph shapes applied at the given influences (relative or absolute). */
function morphed(g, influences) {
  const P = g.attributes.position, N = g.attributes.normal, pos = new Float32Array(P.count * 3), nrm = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) { pos[i * 3] = P.getX(i); pos[i * 3 + 1] = P.getY(i); pos[i * 3 + 2] = P.getZ(i); if (N) { nrm[i * 3] = N.getX(i); nrm[i * 3 + 1] = N.getY(i); nrm[i * 3 + 2] = N.getZ(i); } }
  const MP = g.morphAttributes?.position, MN = g.morphAttributes?.normal;
  if (MP && influences) {
    const rel = g.morphTargetsRelative;
    // (the builder's shapes are all relative: added to the rest; an absolute one is blended from it)
    MP.forEach((a, k) => { const w = influences[k] || 0; if (!w) return; for (let i = 0; i < a.count; i++) { pos[i * 3] += w * (a.getX(i) - (rel ? 0 : P.getX(i))); pos[i * 3 + 1] += w * (a.getY(i) - (rel ? 0 : P.getY(i))); pos[i * 3 + 2] += w * (a.getZ(i) - (rel ? 0 : P.getZ(i))); } });
    if (MN && rel) MN.forEach((a, k) => { const w = influences[k] || 0; if (!w) return; for (let i = 0; i < a.count; i++) { nrm[i * 3] += w * a.getX(i); nrm[i * 3 + 1] += w * a.getY(i); nrm[i * 3 + 2] += w * a.getZ(i); } });
  }
  if (N) for (let i = 0; i < P.count; i++) { const l = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1; nrm[i * 3] /= l; nrm[i * 3 + 1] /= l; nrm[i * 3 + 2] /= l; }
  return { pos, nrm };
}

/** Influences for an eye pose (eye-pose.js names) on mesh m: open and ahead (blink 0) or closed (1). */
function eyeInfluences(m, blink) {
  if (!m.morphTargetDictionary) return m.morphTargetInfluences || null;
  const w = eyeMorphWeights(0, 0, blink), out = (m.morphTargetInfluences || []).slice();
  for (const [name, k] of Object.entries(m.morphTargetDictionary)) if (Object.hasOwn(w, name)) out[k] = w[name];
  return out;
}

/** One mesh as a kit part: its visible triangles, a vertex per (vertex, material) used, colours, weights. */
function partOf(m, boneMap, { role, influences, lidFrom = null, normalMap = false }) {
  const g = m.geometry, mats = [].concat(m.material), groups = g.groups?.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : g.attributes.position.count, materialIndex: 0 }];
  const index = g.index, count = index ? index.count : g.attributes.position.count;
  if (!count) return null;
  const { pos, nrm } = morphed(g, influences);
  const open = lidFrom ? morphed(g, lidFrom).pos : null;
  // (into the skeleton's space: the mesh's bind matrix — the foundation's own pieces were bound where they stood)
  if (!m.bindMatrix.equals(IDENT)) {
    const B = m.bindMatrix, Nm = new THREE.Matrix3().getNormalMatrix(B), v = new THREE.Vector3();
    for (const [arr, isN] of [[pos, false], [nrm, true], ...(open ? [[open, false]] : [])]) for (let i = 0; i < arr.length; i += 3) {
      v.set(arr[i], arr[i + 1], arr[i + 2]); if (isN) v.applyMatrix3(Nm).normalize(); else v.applyMatrix4(B);
      arr[i] = v.x; arr[i + 1] = v.y; arr[i + 2] = v.z;
    }
  }
  const C = g.attributes.color, UV = normalMap ? g.attributes.uv : null, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  if (!SI || !SW) return null;
  const key = new Map(), out = { pos: [], nrm: [], uv: UV ? [] : null, col: [], j: [], w: [], lid: lidFrom ? [] : null, idx: [], rm: [] }, tc = [1, 1, 1];
  for (const gr of groups) {
    const mat = mats[gr.materialIndex ?? 0] || mats[0];
    if (!mat || mat.visible === false) continue;
    const base = mat.color || _c.set(1, 1, 1), vc = !!mat.vertexColors && C;
    const levels = mat.map && g.attributes.uv ? printLevels(mat.map) : null, lv = levels ? printLevel(levels, g, index, [gr]) : null, PU = g.attributes.uv;
    const end = Math.min(count, gr.start + gr.count);
    for (let t = gr.start; t < end; t++) {
      const v = index ? index.getX(t) : t, k = v * 64 + (gr.materialIndex ?? 0);
      let o = key.get(k);
      if (o === undefined) {
        o = out.pos.length / 3; key.set(k, o);
        out.pos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); out.nrm.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
        if (UV) out.uv.push(UV.getX(v), UV.getY(v));
        let r = base.r, gg = base.g, b = base.b;
        if (vc) { r *= C.getX(v); gg *= C.getY(v); b *= C.getZ(v); }
        if (lv) { printAt(lv, PU.getX(v), PU.getY(v), tc); r *= tc[0]; gg *= tc[1]; b *= tc[2]; }
        out.col.push(toByte(srgb(r)), toByte(srgb(gg)), toByte(srgb(b)), normalMap ? 255 : 0);
        out.rm.push(toByte(mat.roughness ?? 0.8), toByte(mat.metalness ?? 0));   // (its finish: the city's light on it as here)
        // the four strongest influences on the city's bone order, out of 255
        const inf = [];
        for (let q = 0; q < SI.itemSize; q++) { const w = SW.getComponent(v, q); if (w > 0) inf.push([boneMap[SI.getComponent(v, q)], w]); }
        inf.sort((a, c) => c[1] - a[1]);
        const s = inf.slice(0, 4).reduce((a, c) => a + c[1], 0) || 1;
        for (let q = 0; q < 4; q++) { out.j.push(inf[q] ? inf[q][0] : 0); out.w.push(inf[q] ? Math.round(inf[q][1] / s * 255) : 0); }
        if (open) out.lid.push(open[v * 3 + 1]);
      }
      out.idx.push(o);
    }
  }
  if (!out.idx.length) return null;
  // (a triangle a mesh draws from both sides keeps its winding: the city draws built characters from both sides too)
  return { name: m.name || role, role, pos: new Float32Array(out.pos), nrm: new Float32Array(out.nrm), uv: out.uv ? new Float32Array(out.uv) : null, col: new Uint8Array(out.col), j: new Uint8Array(out.j), w: new Uint8Array(out.w), idx: new Uint32Array(out.idx), lid: out.lid ? new Float32Array(out.lid) : null, rm: new Uint8Array(out.rm) };
}

/**
 * The kit's bytes for the character on the stage. body: the builder's body (body.js loadBody); preset: its state, kept
 * to open it again. → { bytes: Uint8Array, stats: { parts, verts, tris } }
 */
export function exportKit(body, preset) {
  const { skeleton } = body;
  body.root.updateMatrixWorld(true);
  // each builder bone's place in the city's order; the joints where the shaped skeleton binds them (root space)
  const boneMap = skeleton.bones.map(b => BONES.indexOf(short(b.name)));
  if (boneMap.some(i => i < 0)) throw new Error('This body is not on the city\'s rig');
  const joints = new Float32Array(65 * 3), M = new THREE.Matrix4(), p = new THREE.Vector3();
  skeleton.bones.forEach((b, i) => { M.copy(skeleton.boneInverses[i]).invert(); p.setFromMatrixPosition(M); joints.set([p.x, p.y, p.z], boneMap[i] * 3); });
  const parts = [];
  body.root.traverse(m => {
    if (!m.isSkinnedMesh || !visible(m) || m.skeleton !== skeleton) return;
    const foundation = m.userData.foundationPart, role = foundation ? 'body' : m.userData.slot || m.userData.feature || 'part';
    const rest = eyeInfluences(m, 0);
    const part = partOf(m, boneMap, { role, influences: rest, normalMap: !!foundation && foundation !== 'head' });
    if (part) parts.push(part);
    if (CLOSES.test(m.name || '') && m.morphTargetDictionary && Object.hasOwn(m.morphTargetDictionary, 'Blink')) {
      const closed = partOf(m, boneMap, { role: 'lid', influences: eyeInfluences(m, 1), lidFrom: rest });
      if (closed) { closed.name += ' (closed)'; parts.push(closed); }
    }
  });
  if (!parts.length) throw new Error('Nothing to bake');
  const bytes = encodeKit({ gender: body.gender, joints, parts, preset });
  return { bytes, stats: { parts: parts.length, verts: parts.reduce((s, q) => s + q.pos.length / 3, 0), tris: parts.reduce((s, q) => s + q.idx.length / 3, 0) } };
}
