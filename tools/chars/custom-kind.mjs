// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A character from the builder (client/js/builder/) baked into a character model the city draws like its own
// (render/characters.js): one mesh at three levels of detail, its colours per vertex, and every clip the city plays.
//
// The kit (client/js/builder/export.js) is the assembled character in its bind pose: the 65 joints and each visible part
// (body, face, hair, clothes), with its skin weights and colours, in the builder's units (a body about 1 tall). Here:
// - the parts are joined and scaled to the city's metres (the original bake's: the pelvis of the base body at 0.94 m);
// - two lighter levels of detail are made (meshoptimizer), each part on its own so seams stay closed;
// - the clips: the bake's own (idle, walk, run, sitting, dancing … 39) moved onto this skeleton from the closest of the
//   original characters of its sex (tools/chars/retarget.mjs); then the clips added to every character — swimming,
//   holding things, eating, cooking, fishing, the arcade, nights out, in a car — posed on its own body by
//   tools/chars/extra-clips.mjs, as for every other character, with where it holds things, its head and how it sits;
// - written as <id>.json + <id>.bin, whole (its clips, grips, head and seats in its own manifest).
// Usage (a kit file): node tools/chars/custom-kind.mjs --kit kit.bin --out dir [--id c_…]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadRig, f2h, h2f } from './rig.mjs';
import { retarget } from './retarget.mjs';
import { encodeKit, decodeKit, KIT_VERSION } from '../../shared/char-kit.js';
import { faceTags } from './face-tags.mjs';
import { buildBVH, bakeAO } from './bake-ao.mjs';
// (baked occlusion: not drawn — 2026-11-19, the owner reverted the characters' lighting — so not worked out on a save)
const OCCLUSION = false;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
export const CHARS = path.join(ROOT, 'client/assets/chars');
/** The original bake's scale: the base body's pelvis (0.5365 high in its file) at 0.94 m. */
export const SCALE = 0.94 / 0.5365;
/** The bones, in the rig's order (as every baked character's manifest names them). */
export const BONES = ['Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'LeftToe_End', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase', 'RightToe_End', 'Spine', 'Spine1', 'Spine2',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', ...['Index', 'Middle', 'Pinky', 'Ring', 'Thumb'].flatMap(f => [1, 2, 3, 4].map(i => `LeftHand${f}${i}`)), 'Neck', 'Head', 'HeadTop_End',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', ...['Index', 'Middle', 'Pinky', 'Ring', 'Thumb'].flatMap(f => [1, 2, 3, 4].map(i => `RightHand${f}${i}`))];
/** The bones that keep this body's own bind posture, turned as the reference's turn (tools/chars/retarget.mjs delta). */
export const TRUNK = new Set(['Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End', 'LeftShoulder', 'RightShoulder']);
/** Clips whose hips keep the reference's height (a seat is a seat's height whatever the legs). */
const SEATED = new Set(['sit', 'sit_work', 'sit_idle', 'sit_talk', 'wave_sit']);
/** The original characters a new one may take its clips from (the A-posed batch its base body belongs to). */
const REFS = { male: ['m01', 'm02', 'm03', 'm04', 'm05', 'm06', 'm07', 'm08', 'm09', 'm10', 'm11', 'm12'], female: ['f01', 'f02', 'f03', 'f04', 'f05', 'f06', 'f07', 'f08', 'f09', 'f10', 'f11', 'f12'] };

// ------------------------------------------------------------------ the kit (shared/char-kit.js)
export { encodeKit, decodeKit, KIT_VERSION };
/** A kit's id: its content's hash (the same character baked once). */
export const kitId = buf => 'c_' + crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

// ------------------------------------------------------------------ the mesh
/** The parts joined, scaled to metres: { pos, nrm, uv, col, j, w, lid, idx, partStart: [[firstTri, triCount]] }. */
function joinParts(kit) {
  let n = 0, t = 0;
  for (const p of kit.parts) { n += p.pos.length / 3; t += p.idx.length / 3; }
  const out = { n, t, pos: new Float32Array(n * 3), nrm: new Float32Array(n * 3), uv: new Float32Array(n * 2).fill(-1), col: new Uint8Array(n * 4), j: new Uint8Array(n * 4), w: new Uint8Array(n * 4), lid: new Float32Array(n).fill(-1), idx: new Uint32Array(t * 3), parts: [], names: [], roles: [], partOf: new Uint16Array(n), rm: new Uint8Array(n * 2) };
  let v0 = 0, t0 = 0;
  for (const p of kit.parts) {
    const pn = p.pos.length / 3, pt = p.idx.length / 3;
    for (let i = 0; i < pn * 3; i++) out.pos[v0 * 3 + i] = p.pos[i] * SCALE;
    out.nrm.set(p.nrm, v0 * 3);
    if (p.uv) out.uv.set(p.uv, v0 * 2);
    out.col.set(p.col, v0 * 4); out.j.set(p.j, v0 * 4);
    if (p.rm) out.rm.set(p.rm, v0 * 2); else for (let i = 0; i < pn; i++) { out.rm[(v0 + i) * 2] = 204; out.rm[(v0 + i) * 2 + 1] = 0; }   // (a kit without its finish: matte)
    // weights: four lanes summing to 255 exactly (the shader reads them as fractions)
    for (let i = 0; i < pn; i++) {
      const w = [p.w[i * 4], p.w[i * 4 + 1], p.w[i * 4 + 2], p.w[i * 4 + 3]], s = w[0] + w[1] + w[2] + w[3] || 1;
      const q = w.map(x => Math.round(x * 255 / s)); let d = 255 - (q[0] + q[1] + q[2] + q[3]); const k = q.indexOf(Math.max(...q)); q[k] += d;
      out.w.set(q, (v0 + i) * 4);
    }
    if (p.lid) for (let i = 0; i < pn; i++) out.lid[v0 + i] = p.lid[i] >= 0 ? p.lid[i] * SCALE : -1;
    for (let i = 0; i < pt * 3; i++) out.idx[t0 * 3 + i] = p.idx[i] + v0;
    out.parts.push({ name: p.name, role: p.role, t0, tn: pt, v0, vn: pn });
    out.partOf.fill(out.names.length, v0, v0 + pn); out.names.push(p.name); out.roles.push(p.role);
    v0 += pn; t0 += pt;
  }
  return out;
}

/**
 * The levels of detail, each within its triangle budget (LOD_TRIS): every part simplified to the same error in metres —
 * the largest that keeps the whole within the budget (searched) — so a small part (an eye, a lip) keeps its shape as
 * well as a large one does, and the high-detail face shell gives up most. Colours and normals count as error too (a
 * stripe's edge stays). The full level keeps each part's borders (seams between the body's pieces, hems); the far ones
 * may close them and drop what is smaller than their error. Each level is made from the one before.
 */
async function levels(M, log = () => {}) {
  const { MeshoptSimplifier: S } = await import('meshoptimizer');
  await S.ready;
  const attrs = new Float32Array(M.n * 6);
  for (let v = 0; v < M.n; v++) { for (let q = 0; q < 3; q++) attrs[v * 6 + q] = M.col[v * 4 + q] / 255; for (let q = 0; q < 3; q++) attrs[v * 6 + 3 + q] = M.nrm[v * 3 + q]; }
  const WEIGHTS = [0.012, 0.012, 0.012, 0.004, 0.004, 0.004];
  // (all parts at once: where two pieces meet at the same points — the body's pieces at the neck and shoulders — the
  // simplifier keeps the seam closed; a part's own open edge — a hem, a lock of hair — moves only along itself)
  let runs = [M.idx];
  const out = [];
  const mark = new Uint32Array(M.n);
  let stamp = 0;
  for (let L = 0; L < LOD_TRIS.length; L++) {
    const flags = L === 0 ? ['ErrorAbsolute'] : ['ErrorAbsolute', 'Prune'];
    // within budget: its triangles, and its vertices (each one skinned by four bones from two frames of two clips: a
    // character's cost is mostly its vertices)
    const fits = rs => {
      let t = 0, v = 0; stamp++;
      for (const a of rs) { t += a.length / 3; for (let i = 0; i < a.length; i++) if (mark[a[i]] !== stamp) { mark[a[i]] = stamp; v++; } }
      return t <= LOD_TRIS[L] && v <= LOD_VERTS[L];
    };
    const at = err => runs.map(ix => (ix.length <= 3 ? ix : S.simplifyWithAttributes(ix, M.pos, 3, attrs, 6, WEIGHTS, null, 3, err, flags)[0]));
    let best = runs;
    if (!fits(runs)) {
      // the smallest error (in metres, on a log scale) whose result fits
      let lo = 1e-5, hi = 0.08;
      best = at(hi);
      for (let k = 0; k < 12; k++) {
        const mid = Math.sqrt(lo * hi), r = at(mid);
        if (!fits(r)) lo = mid; else { hi = mid; best = r; }
      }
      // still over (the seams and open edges the simplifier keeps — a printed cloth's, the pieces' hems): a far level is
      // searched again with those free to move too (Permissive), still within the same error in metres
      if (!fits(best) && L > 0) {
        const w = runs;
        const atW = err => w.map(ix => (ix.length <= 3 ? ix : S.simplifyWithAttributes(ix, M.pos, 3, attrs, 6, WEIGHTS, null, 3, err, [...flags, 'Permissive'])[0]));
        let lo2 = 1e-5, hi2 = 0.12, b2 = atW(hi2);
        for (let k = 0; k < 12; k++) { const mid = Math.sqrt(lo2 * hi2), r = atW(mid); if (!fits(r)) lo2 = mid; else { hi2 = mid; b2 = r; } }
        if (fits(b2)) best = b2;
      }
      // and if even that is over: the coarse way, ignoring seams and colours, at the most triangles that fit
      if (!fits(best) && L > 0) {
        log(`level ${L}: coarse simplification (over its budget)`);
        const all = new Uint32Array(best.reduce((n, a) => n + a.length, 0)); { let o = 0; for (const a of best) { all.set(a, o); o += a.length; } }
        let target = Math.min(all.length, LOD_TRIS[L] * 3) - (Math.min(all.length, LOD_TRIS[L] * 3) % 3), r = [all];
        for (let k = 0; k < 24 && target >= 30; k++) { r = [S.simplifySloppy(all, M.pos, 3, null, target, 1)[0]]; if (fits(r)) break; target = Math.floor(target * 0.85 / 3) * 3; }
        best = r;
      }
    }
    runs = best;
    out.push(compact(M, runs));
  }
  return out;
}
/** The budgets: those of the ready-made characters (m01: 24,368 vertices / 40,728 triangles, 6,319 / 9,140, 2,288 / 2,640). */
const LOD_TRIS = [44000, 9200, 2700], LOD_VERTS = [24500, 6400, 2400];
/** The vertices the given index runs use, renumbered. */
function compact(M, keep) {
  const all = new Uint32Array(keep.reduce((s, a) => s + a.length, 0));
  { let o = 0; for (const a of keep) { all.set(a, o); o += a.length; } }
  const remap = new Int32Array(M.n).fill(-1); let n = 0;
  for (const v of all) if (remap[v] < 0) remap[v] = n++;
  const sub = (src, k, T) => { const o = new T(n * k); for (let v = 0; v < M.n; v++) if (remap[v] >= 0) for (let q = 0; q < k; q++) o[remap[v] * k + q] = src[v * k + q]; return o; };
  return { n, t: all.length / 3, rm: sub(M.rm, 2, Uint8Array), ...(M.two ? { two: sub(M.two, 1, Uint8Array) } : {}), ...(M.face ? { face: sub(M.face, 1, Uint8Array), faceU: sub(M.faceU, 1, Float32Array), faceW: sub(M.faceW, 1, Float32Array) } : {}), pos: sub(M.pos, 3, Float32Array), nrm: sub(M.nrm, 3, Float32Array), uv: sub(M.uv, 2, Float32Array), col: sub(M.col, 4, Uint8Array), j: sub(M.j, 4, Uint8Array), w: sub(M.w, 4, Uint8Array), lid: sub(M.lid, 1, Float32Array), idx: all.map(v => remap[v]), parts: M.parts };
}

// ------------------------------------------------------------------ the files
class Bin {
  constructor() { this.chunks = []; this.off = 0; }
  add(arr, type, shape) {
    const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), at = this.off;
    this.chunks.push(b); this.off += b.length;
    const pad = (4 - (this.off % 4)) % 4; if (pad) { this.chunks.push(Buffer.alloc(pad)); this.off += pad; }
    return { off: at, len: b.length, type, shape };
  }
  buffer() { return Buffer.concat(this.chunks); }
}
/** A level of detail's attributes, as render/characters.js reads them (the custom ones' colours in col). */
function lodEntry(bin, L) {
  const n = L.n, mask = new Uint8Array(n * 4), limb = new Float32Array(n * 2), info = new Float32Array(n * 3), cov = new Float32Array(n * 2), col = new Uint8Array(L.col);
  // its light, in room the model has (render/characters.js): how open each vertex is (baked ambient occlusion) in limb.y;
  // its material's finish in col.a with the normal map's flag — bit 0 the flag, bit 1 metal, bits 2–7 its roughness
  for (let v = 0; v < n; v++) { limb[v * 2 + 1] = L.ao ? Math.max(0, Math.min(1, L.ao[v])) : 1; col[v * 4 + 3] = (L.col[v * 4 + 3] > 127 ? 1 : 0) | ((L.rm ? L.rm[v * 2 + 1] : 0) > 76 ? 2 : 0) | (Math.round((L.rm ? L.rm[v * 2] : 204) / 255 * 63) << 2); }
  // an eyelid (closed): drawn only while blinking or asleep, folded up to its pivot (render/characters.js PLACE)
  for (let v = 0; v < n; v++) if (L.lid[v] >= 0) { info[v * 3] = 11; limb[v * 2] = L.lid[v]; }
  // the face, tagged for its motion (tools/chars/face-tags.mjs: the brows, lips and eyes; render/characters.js chFace)
  if (L.face) for (let v = 0; v < n; v++) if (L.face[v]) { mask[v * 4 + 1] = L.face[v]; mask[v * 4 + 2] = Math.round(L.faceU[v] * 255); mask[v * 4 + 3] = Math.round(L.faceW[v] * 255); }
  const idx = n < 65536 ? Uint16Array.from(L.idx) : L.idx;
  return {
    verts: n, tris: L.t,
    pos: bin.add(L.pos, 'float32', [n, 3]), nrm: bin.add(L.nrm, 'float32', [n, 3]),
    j: bin.add(L.j, 'uint8', [n, 4]), w: bin.add(L.w, 'uint8', [n, 4]), mask: bin.add(mask, 'uint8', [n, 4]),
    limb: bin.add(limb, 'float32', [n, 2]), info: bin.add(info, 'float32', [n, 3]), cov: bin.add(cov, 'float32', [n, 2]),
    idx: bin.add(idx, idx instanceof Uint16Array ? 'uint16' : 'uint32', [idx.length]),
    uv: bin.add(L.uv, 'float32', [n, 2]), col: bin.add(col, 'uint8', [n, 4]),
  };
}
/** Skinning frames (Float32Array, 12 per bone per frame) to the bake's half floats, padded to whole texture rows. */
function animTexture(frames, nb, w = 4096) {
  const count = frames.length / 12, texels = count * 3, h = Math.ceil(texels / w), out = new Uint16Array(h * w * 4);
  for (let i = 0; i < frames.length; i++) out[i] = f2h(frames[i]);
  return { w, h, frames: count / nb, data: out };
}

/** The reference: the original character of the same sex whose hips stand nearest this one's. */
function pickReference(gender, J) {
  let best = null;
  for (const k of REFS[gender]) {
    const R = loadRig(CHARS, k);
    if (!R) continue;
    const d = Math.abs(R.J[R.idx.Hips][1] - J[0][1]) + Math.abs(R.J[R.idx.Neck][1] - J[BONES.indexOf('Neck')][1]) * 0.5;
    if (!best || d < best.d) best = { d, R };
  }
  return best.R;
}

/**
 * Bakes a kit into <out>/<id>.json + <id>.bin. → { id, man, ms, ref }. opts: { id, out, log }.
 */
export async function buildKind(kit, { id, out, log = () => {} } = {}) {
  const t0 = Date.now();
  if (!/^c_[0-9a-f]{16}$/.test(id)) throw new Error('bad character id');
  const J = []; for (let b = 0; b < 65; b++) J.push([kit.joints[b * 3] * SCALE, kit.joints[b * 3 + 1] * SCALE, kit.joints[b * 3 + 2] * SCALE]);
  const full = joinParts(kit);
  const ft = faceTags(full); Object.assign(full, { face: ft.face, faceU: ft.u, faceW: ft.w });
  // (which of its vertices face either way: its clothes, hair and face features — the body and head's skin face out)
  full.two = new Uint8Array(full.n); for (let v = 0; v < full.n; v++) { const r = full.roles[full.partOf[v]]; full.two[v] = r !== 'body' && r !== 'base' ? 1 : 0; }
  const lods = await levels(full, log);
  // its ambient occlusion at each level's vertices, against the whole of it at full detail (bind pose): what faces either
  // way from its more open side (2026-11-19: worked out on the full mesh, saving took four times as long)
  if (OCCLUSION) {
    const t1 = Date.now(), B = buildBVH([full]);
    for (const L of lods) {
      const up = bakeAO(L, B, { rays: 20 }), dn = bakeAO({ ...L, nrm: L.nrm.map(x => -x) }, B, { rays: 20, only: L.two });
      for (let v = 0; v < L.n; v++) if (L.two?.[v]) up[v] = Math.max(up[v], dn[v]);
      L.ao = up;
    }
    log(`ambient occlusion: ${lods.map(L => L.n).join('/')} vertices in ${Date.now() - t1} ms`);
  }
  log(`kit ${full.n}v/${full.t}t → lods ${lods.map(L => `${L.n}v/${L.t}t`).join(' ')} (${Date.now() - t0} ms)`);
  // the clips: moved onto this skeleton from the nearest original character
  const R = pickReference(kit.gender, J);
  const rt = retarget(R, { N: BONES, J }, { seated: SEATED, delta: TRUNK });
  log(`clips from ${R.kind} (hips ×${rt.k.toFixed(3)})`);
  // the files, first without the added clips (tools/chars/extra-clips.mjs reads them)
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-kind-'));
  try {
    const write = (frames, clips, extra = {}) => {
      const bin = new Bin(), lodsMeta = lods.map(L => lodEntry(bin, L)), a = animTexture(frames, 65);
      const anim = { w: a.w, h: a.h, frames: a.frames, data: bin.add(a.data, 'uint16', [a.data.length / 4, 4]) };
      const neck = J[BONES.indexOf('Neck')][1];
      const man = {
        kind: id, scale: SCALE, bones: 65, names: BONES.map(n => 'mixamorig:' + n), textured: true, vcol: true,
        land: { waist: +(J[0][1] + 0.058).toFixed(4), neck, neckY: neck }, lods: lodsMeta, clips, anim,
        normalMap: `/assets/builder/${kit.gender}_normal.jpg`, light: 1, custom: { v: KIT_VERSION, gender: kit.gender, ref: R.kind, k: +rt.k.toFixed(4) }, ...(ft.eyes.every(Boolean) ? { face: { eyes: ft.eyes } } : {}), ...extra,
      };
      return { man, bin: bin.buffer() };
    };
    const base = write(rt.frames, R.man.clips.map(c => ({ ...c })));
    fs.writeFileSync(path.join(work, id + '.json'), JSON.stringify(base.man));
    fs.writeFileSync(path.join(work, id + '.bin'), base.bin);
    // the added clips, posed on this body as on every character's
    const tool = path.join(HERE, 'extra-clips.mjs');
    for (const set of [[], ['--set', 'venue']]) {
      const r = spawnSync(process.execPath, [tool, '--dir', work, '--only', id, ...set], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 << 20 });
      if (r.status !== 0) {
        if (process.env.MVW_KIND_DEBUG) console.error(r.stderr, r.stdout);
        throw new Error(`extra clips${set.length ? ' (venue)' : ''}: ${(r.stderr || r.stdout || '').trim().split('\n').filter(l => /Error/.test(l)).slice(0, 2).join(' ')}`);
      }
    }
    const ex = JSON.parse(fs.readFileSync(path.join(work, 'extra-clips.json'), 'utf8'));
    const ve = JSON.parse(fs.readFileSync(path.join(work, 'venue-clips.json'), 'utf8'));
    const half = f => { const u = new Uint16Array(fs.readFileSync(path.join(work, f)).buffer.slice(0)); const o = new Float32Array(u.length); for (let i = 0; i < u.length; i++) o[i] = h2f(u[i]); return o; };
    const exF = half(id + '.extra.bin'), veF = half(id + '.venue.bin');
    const nBase = rt.frames.length / (65 * 12), nEx = exF.length / (65 * 12), nVe = veF.length / (65 * 12);
    if (nEx !== ex.kinds[id] || nVe !== ve.kinds[id]) throw new Error('added clips: frame counts disagree');
    const frames = new Float32Array(rt.frames.length + exF.length + veF.length);
    frames.set(rt.frames); frames.set(exF, rt.frames.length); frames.set(veF, rt.frames.length + exF.length);
    const clips = [...base.man.clips, ...ex.clips.map(c => ({ ...c, off: nBase + c.off })), ...ve.clips.map(c => ({ ...c, off: nBase + nEx + c.off }))];
    const done = write(frames, clips, { grips: ex.grips[id], head: ve.heads[id], seated: ve.seated[id] });
    fs.mkdirSync(out, { recursive: true });
    // (written beside, then renamed: a reader never sees half a file; the model's compressed copies first, the manifest
    // last — a character is there once its manifest is; its preset, to open it in the builder again)
    const zlib = await import('node:zlib'), json = JSON.stringify(done.man);
    const files = [['.bin.br', zlib.brotliCompressSync(done.bin, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 7, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: done.bin.length } })],
      ['.bin.gz', zlib.gzipSync(done.bin, { level: 7 })], ['.bin', done.bin], ['.json.gz', zlib.gzipSync(json)]];
    if (kit.preset) files.push(['.preset.json', JSON.stringify(kit.preset)]);
    files.push(['.json', json]);
    for (const [ext, data] of files) {
      const tmp = path.join(out, `.${id}${ext}.${process.pid}`);
      fs.writeFileSync(tmp, data); fs.renameSync(tmp, path.join(out, id + ext));
    }
    log(`baked ${id}: ${nBase}+${nEx}+${nVe} frames, ${(done.bin.length / 1e6).toFixed(1)} MB, ${Date.now() - t0} ms`);
    return { id, man: done.man, ms: Date.now() - t0, ref: R.kind, align: rt.align };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ command line
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { parseArgs } = await import('node:util');
  const { values: o } = parseArgs({ options: { kit: { type: 'string' }, out: { type: 'string' }, id: { type: 'string' } } });
  const buf = fs.readFileSync(o.kit), kit = decodeKit(buf), id = o.id || kitId(buf);
  const r = await buildKind(kit, { id, out: path.resolve(o.out || '.'), log: m => console.log(m) });
  console.log(JSON.stringify({ id: r.id, ms: r.ms, ref: r.ref, worstAlign: Math.max(...r.align.map(a => a[1])).toFixed(1) }));
}
