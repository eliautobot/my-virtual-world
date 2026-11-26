// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character lab: GPU-instanced Tripo characters (male + female bodies, 65-bone Mixamo rig, 4-weight skinning).
// Same public API as the original renderer (constructor, group, setAppearance, begin, push, end, stats, setShadows).
// - Meshes/clips come from /assets/chars/<kind>.{json,bin} (built by mvw-next-character-module/tools/build_lab_chars.py).
// - Skinning matrices per clip frame live in a half-float texture (3 texels per bone per frame), sampled per vertex with
//   frame interpolation and a two-clip cross-fade.
// - Clothing, hair, and face are painted in the fragment shader from per-vertex region fields (bind position, head/scalp/
//   hand/foot masks, arm/leg progress) and the agent's appearance texels, so every outfit is one draw call per body+LOD.
import * as THREE from 'three';
import { packAppearance, defaultChar, isCustomChar } from '/shared/appearance.js';
import { RIG_BATCHES, RIG_BODIES, normalizeRigSettings, rigBatchForKind } from '/shared/rigProfiles.js';
import { crowdSplit } from '/shared/crowd-split.js';
import { normalizeTuning, allowedParts, nextAllowed, pushOf, applyRig, FACE, TALK_CLIPS, SMILE_CLIPS, plantClips, IDLES, withClipFix } from '/shared/crowd-tuning.js';
import { CLIP_NAMES } from './anim.js';
import { TRIPO_CLIPS, T, OLD_TO_TRIPO, TRIPO_FALLBACK, TRIPO_EXACT } from './charClips.js';
import { COMMON, SKIN_GLSL, packClips } from './char-glsl.js';
import { CharProps, shapeFor, GEAR_CLIP, onTable, deskPoint, DESK_TOP, DESK_LID } from './char-props.js';
import { seatFix, seatClipBits } from './seat-fix.js';
import { MASK_COL } from './outline.js';
import { LIGHT, ROOM_PARS, STREET_PARS } from './light.js';
import { standIns } from './warm.js';
import { TEXTURED } from '/assets/chars/index.js';

export const KINDS = ['male', 'female', ...TEXTURED];
// Characters made in the builder (client/js/builder/; tools/chars/custom-kind.mjs bakes each into a model of its own, with
// every clip the ready-made ones have): added to KINDS the first time a look names one, their files under
// /assets/chars/custom/ (named by their content: never changed, kept by the browser).
const SEX = {};   // (a built one's sex, from the looks that wear it: its stand-in while it loads, its arm calibration)
/** The index of character model `name` (a built one is added the first time it is asked for), or -1. */
export function kindIndex(name, fem) {
  let k = KINDS.indexOf(name);
  if (k < 0 && isCustomChar(name)) k = KINDS.push(name) - 1;
  if (k >= 0 && isCustomChar(name) && fem !== undefined) SEX[name] ??= fem ? 'f' : 'm';
  return k;
}
/** 'f' or 'm' for a model: a ready-made one's by its name, a built one's by its manifest or the looks that wear it. */
const sexOf = (kind, man = null) => (isCrowdKind(kind) ? kind[6] : isCustomChar(kind) ? (man?.custom?.gender === 'female' ? 'f' : man?.custom ? 'm' : SEX[kind] || 'm') : kind[0] === 'f' ? 'f' : 'm');
// The crowd (2026-11-19, a prototype: "unique characters for the population without a major performance cost"): residents
// assembled from a library of parts made by the character builder (assets/crowd/<female|male>.json|.bin, made by
// tools/chars/crowd-pack.mjs) — a body, a head, hair, a beard, a top, bottoms and shoes, each a model of its own
// (crowd_f|top|3 …) drawn instanced for everyone who wears it, all on one animation per body (crowd_f, crowd_m), coloured
// with each resident's own colours. Always on (2026-11-20, the product owner: "it needs to be the default" … "why are
// you doing an off switch?"): no link turns it on or off; the prototype's ?crowd= choice a browser kept (mvw.crowd) is
// cleared. Agents, players and characters built in the Agent Studio keep their own.
const CROWD = true;
try { localStorage.removeItem('mvw.crowd'); } catch { /* (no storage) */ }
const CROWD_PARTS = ['head', 'hair', 'beard', 'top', 'bottom', 'shoes'];
/** A level's skin deep under the clothes (crowd-pack's deep: bits per kind of garment), zeros where it has none — a
 *  library made before it, a part with no skin under clothes (every geometry drawn with the characters' shader has it). */
let ZERO_DEEP = null;   // (one zero buffer shared by every geometry without its own: uploaded once)
const deepAttr = (L, view) => {
  if (L.deep) return new THREE.BufferAttribute(view(L.deep), 3);
  const n = Math.round(L.pos.len / 12);
  if (!ZERO_DEEP || ZERO_DEEP.count < n) ZERO_DEEP = new THREE.BufferAttribute(new Float32Array(Math.max(n, 65536) * 3), 3);
  return ZERO_DEEP;
};
/** The models whose skin may lie under the clothes (a crowd body, a crowd head's neck): only their shader leaves it out —
 *  a shader that may discard keeps the GPU from skipping hidden pixels early, so the clothes, hair and every other
 *  character's keep none (2026-11-20). */
const hidesSkin = kind => /^crowd_[a-z]+$/.test(kind) || /^crowd_[a-z]+\|(body|head)\|/.test(kind);
// The crowd's tuning (shared/crowd-tuning.js, set in the Crowd Studio — client/dev/crowd-studio.html — and kept by the
// server): the parts it never wears, garments pushed out, the skin tucked under the clothes, and the builder bodies'
// posture (turned in their animations as they load: the crowd's and the characters built in the Agent Studio).
let tuningAsk = null;
let tuningNow = null;   // (the tuning once here: the idles of the ready-made characters ask it — Characters.idleFor)
const crowdTuning = () => (tuningAsk ??= fetch('/api/crowd/tuning', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : {})).catch(() => ({})).then(t => (tuningNow = normalizeTuning(t))));
/** The Crowd Studio: its own tuning (not yet saved) instead of the server's, and each body's animation as baked kept
 *  beside the turned one (Characters.applyTuning turns it again). Before any character loads. */
let keepSource = false;
export function studioTuning(t) { tuningNow = normalizeTuning(t); tuningAsk = Promise.resolve(tuningNow); keepSource = true; }
/** A baked animation turned to a body's posture, and some of its clips' own (shared/crowd-tuning.js applyRig; tuning t,
 *  body 'f' or 'm'): { data, src (kept for the studio), frames, bones, names, clips }. */
function rigAnim(data, a, man, t, sex) {
  const anim = { data, src: null, frames: a.frames, bones: man.bones, names: man.names, clips: man.clips || [] };
  // (standing still with its feet where they are: the idles that stepped and slid, planted — shared/crowd-tuning.js;
  // before the studio keeps its source, so turning the posture again keeps them planted)
  if (man.names && typeof plantClips === 'function') plantClips(anim);
  if (keepSource) anim.src = data.slice();
  // (the body's posture, and some clips' own — those made for other proportions set right first: CLIP_FIX)
  if (man.names) applyRig(anim, t?.rig?.[sex], typeof withClipFix === 'function' ? withClipFix(sex, t?.clips?.[sex]) : t?.clips?.[sex]);
  return anim;
}
/** A crowd model's name: its body (crowd_f, crowd_m) or one of its parts (crowd_f|top|3). */
const isCrowdKind = kind => typeof kind === 'string' && kind.startsWith('crowd_');
const isCrowdPart = kind => isCrowdKind(kind) && kind.includes('|');
/** Whether a model is drawn from both sides, as the character builder draws it (2026-11-19, the product owner: clothes and
 *  shoes invisible from some sides — a shoe's sole from behind, the inside of a collar): its garments, hair and face
 *  features are double-sided there (client/js/builder/wardrobe.js, face.js), their surfaces facing either way. A character
 *  built in the Agent Studio (one model, its clothes in it) and the crowd's parts; the crowd's bare body, the builder's
 *  own one-sided body, and the ready-made characters stay one-sided. */
const twoSided = kind => isCustomChar(kind) || (isCrowdPart(kind) && !kind.includes('|body|'));
/** Whether a model casts a shadow: a crowd resident's shoes and beard are left to the body's (a draw call each saved). */
const castsShadow = kind => !(isCrowdPart(kind) && /\|(shoes|beard)\|/.test(kind));
/** The index of crowd model `name`, added to KINDS the first time it is asked for. */
function crowdKind(name) { let k = KINDS.indexOf(name); if (k < 0) k = KINDS.push(name) - 1; return k; }
/** A resident's parts, picked from the library (counts: how many of each) by a hash of who they are and how they look:
 *  the same on every page and after every reload; allowed: the parts of each kind it may wear (shared/crowd-tuning.js
 *  allowedParts — one it may not becomes the next it may). → { head, hair, beard (-1: none), top, bottom (-1: a dress), shoes }. */
function crowdRecipe(i, app, counts, dresses, allowed = null) {
  const str = `${i}|${app?.skin}|${app?.hair}|${app?.top}|${app?.bottom}|${app?.height}`;
  let h = 2166136261; for (let c = 0; c < str.length; c++) { h ^= str.charCodeAt(c); h = Math.imul(h, 16777619); }
  const next = n => { h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13; h = Math.imul(h, 3266489909); h ^= h >>> 16; return (h >>> 0) % Math.max(1, n); };
  const r = {};
  for (const k of CROWD_PARTS) r[k] = counts[k] ? nextAllowed(next(counts[k]), allowed?.[k], counts[k]) : -1;   // (one it may wear: the tuning's)
  if (r.beard >= 0 && next(100) < 45) r.beard = -1;
  r.feet = next(256);   // (its foot size within the library's range: render PLACE uFoot)
  if (dresses?.includes(r.top)) r.bottom = -1;
  return r;
}
/** A point of a body's own frame (Characters.gripPoint) in the world: scaled by its height and build, turned by yaw, at (x, y, z). */
export function bodyToWorld(q, height, build, yaw, x, y, z, out = new THREE.Vector3()) {
  const sx = q[0] * height * build, sy = q[1] * height, sz = q[2] * height * build, c = Math.cos(yaw), s = Math.sin(yaw);
  return out.set(x + sx * c + sz * s, y + sy, z - sx * s + sz * c);
}
const NCL = TRIPO_CLIPS.length;
const T_IDLE = T.idle;   // (standing idle: each builder body's own — Characters.idleFor)
const OLD2T = new Float32Array(CLIP_NAMES.length).map((_, i) => T[OLD_TO_TRIPO[CLIP_NAMES[i]] || 'idle'] ?? 0);
const DANCE = T.dance_01;
const _back = [0], _root = [0, 0, 0], _far = { x: 0, z: 0, back: 0 };

// ------------------------------------------------------------------------------------------------ asset loading
// Lab shortcut: ?only=f01,f02 (or ?char=f01 on the showcase page) loads just those characters instead of all 25 (~209 MB).
const ONLY = (() => {
  try {
    const q = new URLSearchParams(location.search);
    const v = q.get('only') || (location.pathname.includes('/dev/showcase') ? q.get('char') : null);
    return v ? new Set(v.split(',').map(x => x.trim()).filter(Boolean)) : null;
  } catch { return null; }
})();
// The generic built-in male/female bodies are retired: only the textured characters (m01-m12, f01-f12) are loaded.
const wanted = kind => kind !== 'male' && kind !== 'female' && (!ONLY || ONLY.has(kind));
const cache = {};
const extraList = {};
/** The clips added to the baked characters (assets/chars/<set>-clips.json: 'extra', and the nights out's 'venue'), or null. */
function extraClips(set = 'extra') { return (extraList[set] ??= charUrl(`${set}-clips.json`).then(u => fetch(u)).then(r => (r.ok ? r.json() : null)).catch(() => null)); }
// The characters' folder version (server/asset-compress.js, 2026-11-02): every file of theirs is asked for at it, so the
// browser keeps them (a return visit downloads none) and the server sends them compressed.
let charVer = null;
const charV = () => (charVer ??= fetch('/assets/chars/version.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : {})).then(j => j.v || '').catch(() => ''));
const charUrl = async name => { const v = await charV(); return `/assets/chars/${name}${v ? `?v=${v}` : ''}`; };
// (a built character's files: named by their content, so never versioned; its normal map is the base body's, shared)
const customUrl = name => `/assets/chars/custom/${name}`;
const mapUrl = async name => (name.startsWith('/') ? name : charUrl(name));
// Character assets load in a worker when the browser allows (main-thread fallback otherwise).
let worker = null, workerFailed = false, nextJob = 0;
const jobs = new Map();
function viaWorker(msg, transfer) {
  if (workerFailed || typeof Worker !== 'function') return null;
  if (!worker) {
    try { worker = new Worker(new URL('./char-loader.worker.js', import.meta.url), { type: 'module' }); }
    catch { workerFailed = true; return null; }
    worker.onmessage = e => { const j = jobs.get(e.data.id); if (!j) return; jobs.delete(e.data.id); if (e.data.error) j.reject(new Error(e.data.error)); else j.resolve(e.data); };
    worker.onerror = () => { workerFailed = true; worker = null; for (const j of jobs.values()) j.retry(); jobs.clear(); };
  }
  return new Promise((resolve, reject) => { const id = ++nextJob; jobs.set(id, { resolve, reject, retry: () => resolve(null) }); worker.postMessage({ ...msg, id }, transfer || []); });
}
// Decode maps off the main thread when the browser can. Same pixels as the <img> path three.js used: no flip, no
// premultiplication and no colour conversion (three uploads both maps with UNPACK_COLORSPACE_CONVERSION = NONE here).
async function loadMap(url, size = 2048) {
  if (typeof createImageBitmap !== 'function') return new THREE.TextureLoader().loadAsync(url);
  const done = await viaWorker({ op: 'map', url: new URL(url, location.href).href, size });
  if (done) { const t = new THREE.Texture(done.bitmap); t.needsUpdate = true; return t; }
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  const opts = { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  // Medium/Low quality draw characters small: decoding straight to a smaller size (off the main thread) cuts GPU
  // memory and upload time 4x/16x. Published maps are 2048 square; the full size is decoded unchanged.
  const small = size < 2048 ? { resizeWidth: size, resizeHeight: size, resizeQuality: 'high' } : {};
  const t = new THREE.Texture(await createImageBitmap(await r.blob(), { ...opts, ...small })); t.needsUpdate = true;
  return t;
}
// Geometry and animation load once per model; maps once per model and size (Customizer previews keep full size).
const bundles = {}, crowdMaps = {};
function loadKind(kind, mapSize = 2048, normalSize = mapSize) {
  const key = kind + '@' + mapSize + '/' + normalSize;
  // (a crowd model: from its body's library; the body's skin takes the base body's normal map, the parts none)
  if (isCrowdKind(kind)) return (bundles[key] ??= (kind.endsWith('|c') ? loadCrowdClose(kind[6]) : loadCrowd(kind[6])).then(async kinds => {
    const d = kinds[kind]; if (!d) throw new Error('no crowd part ' + kind);
    const normalMap = d.part ? null : await (crowdMaps[d.man.normalMap + '@' + normalSize] ??= loadMap(d.man.normalMap, normalSize).then(t => { t.flipY = false; t.colorSpace = THREE.NoColorSpace; return t; }).catch(() => null));
    return { ...d, normalMap, colorMap: null };
  }));
  bundles[key] ??= loadBase(kind).then(async base => {
    const { man } = base;
    let normalMap = null, colorMap = null;
    if (man.baseColor) {
      colorMap = await loadMap(await mapUrl(man.baseColor), mapSize);
      colorMap.flipY = false; colorMap.colorSpace = THREE.SRGBColorSpace; colorMap.anisotropy = 4;
    }
    if (man.normalMap) {
      normalMap = await loadMap(await mapUrl(man.normalMap), normalSize).catch(() => null);
      if (normalMap) { normalMap.flipY = false; normalMap.colorSpace = THREE.NoColorSpace; }
    }
    return { ...base, normalMap, colorMap };
  });
  return bundles[key];
}
function loadBase(kind) {
  if (cache[kind]) return cache[kind];
  cache[kind] = (async () => {
    const built = isCustomChar(kind);
    const [ju, bu] = built ? [customUrl(`${kind}.json`), customUrl(`${kind}.bin`)] : await Promise.all([charUrl(`${kind}.json`), charUrl(`${kind}.bin`)]);
    // the clips added after the bake (tools/chars/extra-clips.mjs: 'extra', then the nights out's 'venue'): their frames
    // come down with the model and are joined to its own in the worker (2026-11-02: joining several MB here, on the main
    // thread, as each model arrived was one of the first half minute's hitches on a phone). A built character's are in
    // its own files already.
    const adds = [];
    if (!built) for (const set of ['extra', 'venue']) { const xs = await extraClips(set), ef = xs?.kinds?.[kind]; if (ef) adds.push({ set, url: await charUrl(`${kind}.${set}.bin`), ef, clips: xs.clips }); }
    // (the crowd's tuning turned into the animation in the worker as well — not in the Crowd Studio, which keeps its source)
    const tuneNow = keepSource ? null : await crowdTuning();
    const done = await viaWorker({ op: 'base', kind, json: ju, bin: bu, adds, tuning: tuneNow ? { rig: tuneNow.rig || {}, clips: tuneNow.clips || {}, readyMade: tuneNow.readyMade !== false } : null });
    const [man, bin] = done ? [done.man, done.bin] : await Promise.all([
      fetch(ju).then(r => { if (!r.ok) throw new Error(kind + '.json ' + r.status); return r.json(); }),
      fetch(bu).then(r => { if (!r.ok) throw new Error(kind + '.bin ' + r.status); return r.arrayBuffer(); }),
    ]);
    const view = e => {
      const C = { float32: Float32Array, uint8: Uint8Array, uint16: Uint16Array, uint32: Uint32Array }[e.type];
      return new C(bin, e.off, e.len / C.BYTES_PER_ELEMENT);
    };
    const lods = man.lods.map(L => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(view(L.pos), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(view(L.nrm), 3));
      if (L.uv) g.setAttribute('uv', new THREE.BufferAttribute(view(L.uv), 2));
      g.setAttribute('aJ', new THREE.BufferAttribute(view(L.j), 4));
      g.setAttribute('aW', new THREE.BufferAttribute(view(L.w), 4, true));
      g.setAttribute('aMask', new THREE.BufferAttribute(view(L.mask), 4, true));
      g.setAttribute('aLimb', new THREE.BufferAttribute(view(L.limb), 2));
      g.setAttribute('aInfo', new THREE.BufferAttribute(view(L.info), 3));
      g.setAttribute('aCov', new THREE.BufferAttribute(view(L.cov), 2)); g.setAttribute('aDeep', deepAttr(L, view));
      // (a built character's colours, per vertex: sRGB, and in alpha whether the base body's normal map applies)
      if (L.col) g.setAttribute('aCol', new THREE.BufferAttribute(view(L.col), 4, true));
      g.setIndex(new THREE.BufferAttribute(view(L.idx), 1));
      g.userData.tris = L.tris;
      return g;
    });
    let a = man.anim, animData = done?.anim ? new Uint16Array(done.anim) : view(a.data);
    // clips added after the bake (tools/chars/extra-clips.mjs: swimming, the walk and run with their loops mended, which
    // take the place of the bake's by name below, and holding things): their frames follow the bake's own — joined by
    // the worker (done.applied), or here when there is no worker
    const ex = built ? null : await extraClips();
    let added = false, head = null;
    if (built) { added = !!man.grips; head = man.head || null; }
    else if (done) { added = done.applied.includes('extra'); if (done.applied.includes('venue')) head = (await extraClips('venue'))?.heads?.[kind] || null; }
    else for (const set of ['extra', 'venue']) {   // (then the nights out's: tools/chars/extra-clips.mjs --set venue)
      const xs = set === 'extra' ? ex : await extraClips(set), ef = xs?.kinds?.[kind];
      if (!ef) continue;
      const eb = await fetch(adds.find(x => x.set === set).url).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
      if (eb && eb.byteLength === ef * man.bones * 24) {
        const base = a.frames * man.bones * 12, h = Math.ceil((a.frames + ef) * man.bones * 3 / a.w), merged = new Uint16Array(h * a.w * 4);
        merged.set(animData.subarray(0, base)); merged.set(new Uint16Array(eb), base);
        man.clips = [...man.clips, ...xs.clips.map(c => ({ ...c, off: a.frames + c.off }))];
        a = man.anim = { ...a, h, frames: a.frames + ef }; animData = merged;
        if (set === 'extra') added = true;
        else head = xs.heads?.[kind] || null;   // (its head's frame: what is worn on it, render/char-props.js)
      }
    }
    // (a character built in the Agent Studio: the builder's body, in the posture the crowd's tuning gives it; a ready-made
    // one — a player's, a resident's with the classic look — the same by its body, unless the tuning says not: readyMade)
    const tune = await crowdTuning();
    const anim = done?.rigged ? { data: animData, src: null, frames: a.frames, bones: man.bones, names: man.names, clips: man.clips || [] }   // (turned in the worker)
      : built ? rigAnim(animData, a, man, tune, man.custom?.gender === 'female' ? 'f' : 'm')
      : tune?.readyMade !== false && man.names ? rigAnim(animData, a, man, tune, sexOf(kind, man)) : null;
    const tex = new THREE.DataTexture(animData, a.w, a.h, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
    const off = new Float32Array(NCL), len = new Float32Array(NCL);
    man.clips.forEach(c => { const k = T[c.name]; if (k !== undefined) { off[k] = c.off; len[k] = c.len; } });
    // a clip this character lacks (its added frames missing or not yet made) plays as another, never as no frames at all
    TRIPO_CLIPS.forEach((n, k) => { if (len[k]) return; const f = T[TRIPO_FALLBACK[n]] ?? T.idle; off[k] = off[f]; len[k] = len[f] || len[T.idle]; });
    // the clips placed exactly against the body (charClips.js TRIPO_EXACT) play without the arm calibration: their length
    // goes negative (char-glsl.js chRigK) — only when the character has them, not a stand-in
    for (const n of TRIPO_EXACT) if (man.clips.some(c => c.name === n)) len[T[n]] = -Math.abs(len[T[n]]);
    // where it holds things (tools/chars/extra-clips.mjs grips): only with its added frames, which the hold clips are
    const g0 = added ? (built ? man.grips : ex.grips?.[kind]) || null : null, grips = g0 && head ? { ...g0, H: head } : g0;
    return { man, lods, tex, anim, off, len, clip: packClips(off, len), grips };
  })();
  return cache[kind];
}

// The crowd's library, one file each body: its animation (one texture every part samples), then each part's levels.
const crowdPacks = {};
// (its version, and — split: once the server has the library in two files, shared/crowd-split.js — theirs)
let crowdInfoAsk = null;
const crowdInfo = () => (crowdInfoAsk ??= fetch('/assets/crowd/version.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : {})).catch(() => ({})));
const crowdV = () => crowdInfo().then(j => j.v || '');
const crowdSplitV = () => crowdInfo().then(j => (CROWD && !keepSource && typeof j.split === 'string' && j.split) || null);
/** The manifest of body `sex` ('f', 'm'): counts and dresses as soon as it is here (its parts' recipes need them). */
const crowdManifests = {};
function crowdManifest(sex) {
  return (crowdManifests[sex] ??= crowdV().then(v => fetch(`/assets/crowd/${sex === 'f' ? 'female' : 'male'}.json${v ? `?v=${v}` : ''}`)).then(r => { if (!r.ok) throw new Error('crowd ' + r.status); return r.json(); }));
}
/** The library's bytes of body `sex`: received in the loader worker when there is one (off the main thread), asked for
 *  once — by crowdPrefetch at the start of the page, or by the first resident drawn. */
const crowdBins = {};
async function bytesOf(url) {
  const done = await viaWorker({ op: 'bytes', url: new URL(url, location.href).href });
  if (done) return done.buf;
  return fetch(url).then(r => { if (!r.ok) throw new Error(`${url.split('?')[0]} ${r.status}`); return r.arrayBuffer(); });
}
function crowdBin(sex) {
  return (crowdBins[sex] ??= crowdV().then(v => bytesOf(`/assets/crowd/${sex === 'f' ? 'female' : 'male'}.bin${v ? `?v=${v}` : ''}`)));
}
/** The library in two files (shared/crowd-split.js): 'far' — everyone drawn from a distance, both bodies' first —
 *  then 'near', each part's finest level, asked for once both bodies' far files are here. */
const crowdHalves = {};
function crowdHalf(sex, half) {
  const key = sex + half;
  if (crowdHalves[key]) return crowdHalves[key];
  const url = v => `/assets/crowd-split/${sex === 'f' ? 'female' : 'male'}.${half}.bin?v=${v}`;
  return (crowdHalves[key] = crowdSplitV().then(async v => {
    if (!v) throw new Error('no split library');
    if (half === 'near') await Promise.all(['f', 'm'].map(x => crowdHalf(x, 'far').catch(() => null)));
    return bytesOf(url(v));
  }));
}
/** Both bodies' libraries asked for at once, as the page starts (render: main.js) — they used to be asked for only once
 *  the residents were placed, and the second only when the first had arrived (2026-11-24: a phone's residents appeared
 *  6 s after the world). Only the bytes: they are made into models when a resident is first drawn (loadCrowd). */
export function crowdPrefetch() {
  if (!CROWD || keepSource) return;
  crowdTuning();
  crowdSplitV().then(split => {
    for (const sex of ['f', 'm']) {
      crowdManifest(sex).catch(() => {});
      if (split) { crowdHalf(sex, 'far').catch(() => {}); crowdHalf(sex, 'near').catch(() => {}); }
      else crowdBin(sex).catch(() => {});
    }
  });
}
function loadCrowd(sex) {
  return (crowdPacks[sex] ??= (async () => {
    const man = await crowdManifest(sex);
    // its bytes: the far file when the server has the library split (shared/crowd-split.js) — everyone drawn from it at
    // once, each part's finest level put in place when the near file comes (refine, below) — else the whole library
    let far = null, split = null, bin = null;
    if (await crowdSplitV()) {
      try { far = await crowdHalf(sex, 'far'); split = crowdSplit(man); }
      catch (err) { console.warn('the crowd\'s split library failed to load; reading the whole one', err); far = split = null; }
    }
    if (!far) bin = await crowdBin(sex);
    const TYPES = { float32: Float32Array, uint8: Uint8Array, uint16: Uint16Array, uint32: Uint32Array };
    const viewIn = (buf, off, e) => { const C = TYPES[e.type]; return new C(buf, off, e.len / C.BYTES_PER_ELEMENT); };
    const placed = e => { const at = split.at.get(e.off); if (!at) throw new Error('a crowd section missing from the split'); return at; };
    const view = split ? e => { const at = placed(e); if (at.near) throw new Error('a crowd section only in the near file'); return viewIn(far, at.off, e); } : e => viewIn(bin, e.off, e);
    const isNear = Lv => !!split && placed(Lv.pos).near;
    const geomWith = view => L => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(view(L.pos), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(view(L.nrm), 3));
      if (L.uv) g.setAttribute('uv', new THREE.BufferAttribute(view(L.uv), 2));
      g.setAttribute('aJ', new THREE.BufferAttribute(view(L.j), 4));
      g.setAttribute('aW', new THREE.BufferAttribute(view(L.w), 4, true));
      g.setAttribute('aMask', new THREE.BufferAttribute(view(L.mask), 4, true));
      g.setAttribute('aLimb', new THREE.BufferAttribute(view(L.limb), 2));
      g.setAttribute('aInfo', new THREE.BufferAttribute(view(L.info), 3));
      g.setAttribute('aCov', new THREE.BufferAttribute(view(L.cov), 2)); g.setAttribute('aDeep', deepAttr(L, view));
      g.setAttribute('aCol', new THREE.BufferAttribute(view(L.col), 4, true));
      g.setIndex(new THREE.BufferAttribute(view(L.idx), 1));
      g.userData.tris = L.tris;
      return g;
    };
    const geom = geomWith(view);
    // (the near file's sections, once it is here: every section viewed in whichever of the two files holds it)
    const nearGeom = split ? crowdHalf(sex, 'near').then(near => geomWith(e => { const at = placed(e); return viewIn(at.near ? near : far, at.off, e); })) : null;
    /** A part's levels: in the far file now, a level only in the near one drawn as the next coarser until it comes —
     *  { lods, refine: a promise of all its own levels (null: nothing to wait for) }. */
    const levels = list => {
      const lods = list.map(Lv => (isNear(Lv) ? null : geom(Lv)));
      for (let i = lods.length - 1; i >= 0; i--) if (!lods[i]) lods[i] = lods[i + 1] || null;
      const own = list.map((Lv, i) => (isNear(Lv) ? null : lods[i]));
      const refine = nearGeom && own.some(g => !g) ? nearGeom.then(ng => list.map((Lv, i) => own[i] || ng(Lv))) : null;
      refine?.catch(() => {});   // (the near file failed: drawn from the far one; told once, by the model's initKind)
      return { lods, refine };
    };
    const a = man.anim, anim = rigAnim(view(a.data), a, man, await crowdTuning(), sex);   // (the body's posture: the tuning's)
    const tex = new THREE.DataTexture(anim.data, a.w, a.h, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
    const off = new Float32Array(NCL), len = new Float32Array(NCL);
    man.clips.forEach(c => { const k = T[c.name]; if (k !== undefined) { off[k] = c.off; len[k] = c.len; } });
    TRIPO_CLIPS.forEach((n, k) => { if (len[k]) return; const f = T[TRIPO_FALLBACK[n]] ?? T.idle; off[k] = off[f]; len[k] = len[f] || len[T.idle]; });
    for (const n of TRIPO_EXACT) if (man.clips.some(c => c.name === n)) len[T[n]] = -Math.abs(len[T[n]]);
    const grips = man.grips ? (man.head ? { ...man.grips, H: man.head } : man.grips) : null;
    // (the tints' references, linear: a part's vertex of key k is drawn × the resident's colour ÷ this)
    const tint = [new THREE.Vector3(1, 1, 1), ...man.keys.map(k => new THREE.Vector3(...man.tints[k]))];
    const shared = { man, tex, anim, off, len, clip: packClips(off, len), grips, tint, feet: man.feet || null };
    const kinds = { [`crowd_${sex}`]: { ...shared, ...levels(man.parts.body[0].lods) } };
    for (const cat of CROWD_PARTS) (man.parts[cat] || []).forEach((p, n) => { kinds[`crowd_${sex}|${cat}|${n}`] = { ...shared, ...levels(p.lods), part: cat }; });
    return kinds;
  })());
}

/** The crowd's close-up level (the owner's bake: tools/chars/crowd-pack.mjs close), a file of its own fetched the first time
 *  someone is drawn that close: each part — and the body — a model of its own (crowd_f|top|3|c, crowd_f|body|0|c), on
 *  the body's animation. → { kind: data } ({} when this library has none). */
const crowdClose = {};
function loadCrowdClose(sex) {
  return (crowdClose[sex] ??= (async () => {
    const base = await loadCrowd(sex), shared = base[`crowd_${sex}`], man = shared.man, v = await crowdV();
    if (!man.close?.file) return {};
    const bin = await fetch(`/assets/crowd/${man.close.file}${v ? `?v=${v}` : ''}`).then(r => { if (!r.ok) throw new Error('crowd close ' + r.status); return r.arrayBuffer(); });
    const view = e => { const C = { float32: Float32Array, uint8: Uint8Array, uint16: Uint16Array, uint32: Uint32Array }[e.type]; return new C(bin, e.off, e.len / C.BYTES_PER_ELEMENT); };
    const geom = L => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(view(L.pos), 3)); g.setAttribute('normal', new THREE.BufferAttribute(view(L.nrm), 3));
      if (L.uv) g.setAttribute('uv', new THREE.BufferAttribute(view(L.uv), 2));
      g.setAttribute('aJ', new THREE.BufferAttribute(view(L.j), 4)); g.setAttribute('aW', new THREE.BufferAttribute(view(L.w), 4, true));
      g.setAttribute('aMask', new THREE.BufferAttribute(view(L.mask), 4, true)); g.setAttribute('aLimb', new THREE.BufferAttribute(view(L.limb), 2));
      g.setAttribute('aInfo', new THREE.BufferAttribute(view(L.info), 3)); g.setAttribute('aCov', new THREE.BufferAttribute(view(L.cov), 2)); g.setAttribute('aDeep', deepAttr(L, view));
      g.setAttribute('aCol', new THREE.BufferAttribute(view(L.col), 4, true));
      g.setIndex(new THREE.BufferAttribute(view(L.idx), 1)); g.userData.tris = L.tris;
      return g;
    };
    const { lods, part, refine, ...rest } = shared, kinds = {};
    void lods; void part; void refine;
    for (const cat of ['body', ...CROWD_PARTS]) (man.parts[cat] || []).forEach((p, n) => { if (p.close) kinds[`crowd_${sex}|${cat}|${n}|c`] = { ...rest, lods: [geom(p.close)], ...(cat === 'body' ? {} : { part: cat }) }; });
    return kinds;
  })());
}

// ------------------------------------------------------------------------------------------------ shaders
const VERT_PARS = /* glsl */`
attribute vec4 aJ;
attribute vec4 aW;
attribute vec4 aMask;
attribute vec2 aLimb;
attribute vec3 aInfo;
attribute vec2 aCov;
attribute vec3 aDeep;   // (a crowd body's skin deep under the garments worn — far from their collars, cuffs, hems: their bits)
attribute vec4 iPos;
attribute vec4 iAnim;
attribute vec4 iMisc;
uniform float uTime;
uniform float uLidForce;   // <0: automatic (blink, closed while lying); 0..1: forced
uniform vec4 uFootL, uFootR;   // (a crowd body's ankles, bind space; w 1: its feet sized per resident — texel 7's red)
uniform float uPush;           // (a crowd part pushed out along its surface, metres: the tuning's)
uniform float uTuck;           // (how far a crowd body's skin under the clothes worn is pulled in, metres: the tuning's)
uniform float uHideCov;        // (1: that skin not drawn where wholly under them — the tuning's hide)
// a crowd head's face in motion (tools/chars/crowd-pack.mjs faceTags: aMask.y its region, .z across the mouth or along a
// brow, .w its share of the mouth's opening; the tuning's face — shared/crowd-tuning.js FACE)
uniform vec4 uEyeL, uEyeR;     // (its eyes' centres, bind space; w 1: a head whose face moves)
uniform vec4 uFace;            // (glances: radians, every … seconds; brows: metres, every … seconds)
uniform vec4 uFace2;           // (smile: metres at the corners, the share who smile at rest; talking: metres, syllables a second)
uniform vec4 uFaceForce;       // (the Crowd Studio's preview: gaze across, up — radians — brows 0..1, smile 0..1)
uniform vec4 uFaceForce2;      // (… talking 0..1; y > 0.5: the preview on)
uniform ivec3 uTalkClips, uSmileClips;   // (the clips that talk, that smile: a bit each)
uniform ivec3 uSeatClips;      // (the clips seated on a bench, a chair, at a table: a bit each — render/seat-fix.js)
uniform vec4 uSeatFix;         // (a builder body's seat: lift, back, the seat's height its own scales about; w 1: on)
uniform float uBlinkEvery;     // (a blink every … seconds, about: every character's eyelids; 0 never)
// a model baked 2026-11-19 (its manifest's light) packs its material's finish into aCol.a beside the normal map's flag
// (bit 0 the flag, 1 metal, 2–7 roughness): uShade 1 reads the flag's bit. The finish and its baked occlusion (aLimb.y)
// are not drawn (2026-11-19, the owner: the lighting, shadows and shine "don't look good, revert those").
uniform float uShade;
${COMMON}
${SKIN_GLSL}
#ifndef CHAR_DEPTH
varying vec3 vBind;
varying vec4 vMask;
varying vec4 vLimb;
flat varying float vApp;
flat varying float vPart;
varying float vCovered;
#endif
#ifdef CHAR_VCOL
attribute vec4 aCol;
varying vec4 vCol;
#endif
mat4 charM;
vec3 charRig;
uniform vec3 uRig;
float charHide;
float charLid;
float charShrink;
float charCov;
float charSeat;   // (seated on a seat, 0..1 across a blend: render/seat-fix.js)
float charH;
float charB;
mat4 chSkin(int c, float phase) {
  mat4 m = chBoneAt(c, phase, int(aJ.x + 0.5)) * aW.x;
  if (aW.y > 0.004) m += chBoneAt(c, phase, int(aJ.y + 0.5)) * aW.y;
  if (aW.z > 0.004) m += chBoneAt(c, phase, int(aJ.z + 0.5)) * aW.z;
  if (aW.w > 0.004) m += chBoneAt(c, phase, int(aJ.w + 0.5)) * aW.w;
  return m;
}
float chHash(float a, float k) { return fract(sin(a * 12.9898 + k * 78.233) * 43758.5453); }
bool chClipIn(ivec3 m, int c) { int w = c >> 5, b = c & 31; int v = w == 0 ? m.x : w == 1 ? m.y : m.z; return c < 96 && ((v >> b) & 1) == 1; }
// A crowd head's face in motion, in bind space: the eyes turned about their centres to glance about, the brows raised now
// and then, the mouth's corners up in a smile, the lower lip (and the opening behind it) down as they talk.
vec3 chFace(vec3 p) {
  int f = int(aMask.y * 255.0 + 0.5);
  if (f == 0) return p;
  float a = iMisc.y, t = uTime, hs = chHash(a, 1.0);
  bool forced = uFaceForce2.y > 0.5;
  if (f >= 6) {
    vec2 g;
    if (forced) g = uFaceForce.xy;
    else {
      float per = max(0.5, uFace.y * (0.7 + hs * 0.6)), q = t / per + hs * 7.0, k = floor(q), s = fract(q) * per;
      vec2 g1 = (vec2(chHash(a, k), chHash(a, k + 0.5)) - 0.5) * vec2(2.0, 0.8) * uFace.x;
      vec2 g0 = (vec2(chHash(a, k - 1.0), chHash(a, k - 0.5)) - 0.5) * vec2(2.0, 0.8) * uFace.x;
      if (chHash(a, k + 0.25) < 0.4) g1 = vec2(0.0);
      if (chHash(a, k - 0.75) < 0.4) g0 = vec2(0.0);
      g = mix(g0, g1, smoothstep(0.0, 0.14, s));
    }
    vec3 c = f == 6 ? uEyeL.xyz : uEyeR.xyz, d = p - c;
    float cy = cos(g.x), sy = sin(g.x), cp = cos(g.y), sp = sin(g.y);
    d = vec3(cy * d.x + sy * d.z, d.y, -sy * d.x + cy * d.z);   // (+ to its left)
    d = vec3(d.x, cp * d.y + sp * d.z, -sp * d.y + cp * d.z);   // (+ up)
    return c + d;
  }
  if (f == 1) {
    float b;
    if (forced) b = uFaceForce.z;
    else {
      float per = max(1.0, uFace.w * (0.75 + hs * 0.5)), q = t / per + hs * 5.0, k = floor(q), s = fract(q) * per;
      b = chHash(a, k + 3.0) < 0.55 ? smoothstep(0.0, 0.2, s) * (1.0 - smoothstep(0.7, 1.1, s)) : 0.0;
    }
    p.y += b * uFace.z * (1.0 - 0.3 * aMask.z);   // (the inner ends a little more)
    return p;
  }
  int c = int(iAnim.x + 0.5);
  float sm, tk;
  if (forced) { sm = uFaceForce.w; tk = uFaceForce2.x; }
  else {
    sm = chClipIn(uSmileClips, c) ? 1.0 : hs < uFace2.y ? 0.25 + 0.4 * chHash(a, 2.0) : 0.0;
    tk = chClipIn(uTalkClips, c) ? 1.0 : 0.0;
  }
  float open = 0.0;
  if (tk > 0.0) {
    float q = t * uFace2.w + hs * 6.283;
    open = tk * max(0.0, sin(q * 3.14159)) * (0.6 + 0.4 * sin(q * 0.93 + 1.0)) * step(0.2, fract(t * 0.23 + hs));
  }
  float u = aMask.z * 2.0 - 1.0, up = sm * uFace2.x * u * u;
  if (f == 2 || f == 4) p.y += up;
  else if (f == 3) p.y += up * 0.85 - open * uFace2.z;
  else if (f == 5) p.y += up * 0.85 - open * uFace2.z * aMask.w;
  p.x += sm * uFace2.x * 0.3 * u * abs(u);   // (the corners a little wider)
  return p;
}
void charCompute() {
  int a = int(iMisc.y + 0.5);
  int cat = int(aInfo.y + 0.5);
  int msk = int(aInfo.z + 0.5);
  int ts = chSty(chAppI(a, 2).a), bs = chSty(chAppI(a, 3).a);
  charHide = 0.0;
  if (cat == 1) charHide = ((msk >> chSty(chAppI(a, 1).a)) & 1) == 0 ? 1.0 : 0.0;
  else if (cat == 2) charHide = ((msk >> ts) & 1) == 0 ? 1.0 : 0.0;
  else if (cat == 3) charHide = (ts == 6 || ((msk >> bs) & 1) == 0) ? 1.0 : 0.0;
  else if (cat == 6) charHide = ((msk >> chSty(chAppI(a, 5).a)) & 1) == 0 ? 1.0 : 0.0;
  charLid = 1.0;
  if (aInfo.x > 10.5) {                                        // eyelid patch: closed while lying (sleep), otherwise a short blink every few seconds
    // (each person's own pace and moment, from who they are — iMisc.y — not where they stand: from their position it
    // changed every frame they walked, and their eyelids flashed shut at random, many times a second — 2026-11-20)
    float h = chHash(iMisc.y, 5.0);
    float per = max(0.5, uBlinkEvery * (0.75 + h * 0.5)), ph = mod(uTime + h * 17.0, per);   // (the tuning's pace: 3.6–6 s by default)
    charLid = uBlinkEvery > 0.0 && ph < 0.2 ? sin(ph / 0.2 * 3.14159) : 0.0;
    if (int(iAnim.x + 0.5) == 4) charLid = 1.0;
    if (uLidForce >= 0.0) charLid = uLidForce;
    if (charLid < 0.03) charHide = 1.0;
  }
  charShrink = 0.0; charCov = 0.0; charSeat = 0.0;
  if (uSeatFix.w > 0.5) {
    charSeat = chClipIn(uSeatClips, int(iAnim.x + 0.5)) ? 1.0 : 0.0;
    if (iMisc.x > 0.003) charSeat = mix(charSeat, chClipIn(uSeatClips, int(iAnim.z + 0.5)) ? 1.0 : 0.0, iMisc.x);
  }
  if (cat == 9) {                                              // a crowd body's skin under the garments worn (their bits)
    int ct = int(aCov.x + 0.5), cb = int(aCov.y + 0.5), cs = int(aInfo.z + 0.5);
    int ti = chSty(chAppI(a, 2).a), bi = chSty(chAppI(a, 3).a), si = chSty(chAppI(a, 4).a);
    bool cv = (ti < 24 && ((ct >> ti) & 1) == 1) || (bi < 24 && ((cb >> bi) & 1) == 1) || (si < 24 && ((cs >> si) & 1) == 1);
    charShrink = cv ? uTuck : 0.0;
    // left out only deep under them — under them in every pose the crowd plays, and 7 cm along the skin from any opening
    // (crowd-pack); nearer, a collar or hem that moves off it as the body bends, sits or turns shows skin, not a hole
    // (2026-11-20: empty necks and waists)
    int dt = int(aDeep.x + 0.5), db = int(aDeep.y + 0.5), ds = int(aDeep.z + 0.5);
    bool dv = (ti < 24 && ((dt >> ti) & 1) == 1) || (bi < 24 && ((db >> bi) & 1) == 1) || (si < 24 && ((ds >> si) & 1) == 1);
    charCov = dv ? 1.0 : 0.0;
  } else if (cat == 0) {
    int ct = int(aCov.x + 0.5), cb = int(aCov.y + 0.5);
    bool cov = ((ct >> ts) & 1) == 1 || (ts != 6 && ((cb >> bs) & 1) == 1) || (cb & 16) == 16;
    charShrink = cov ? 0.008 : 0.0;
  }
  // (seated in a car: smaller as its roof needs — flags' bits 3+, render/seat-fit.js seatScale)
  charH = (0.8 + chAppI(a, 0).a * 0.4) * (1.0 - float((int(iMisc.w + 0.5) >> 3) & 255) / 300.0);
  charB = 0.8 + chAppI(a, 6).a * 0.45;
  if (charHide > 0.5) { charM = mat4(1.0); }
  else {
    charM = chSkin(int(iAnim.x + 0.5), iAnim.y);
    if (iMisc.x > 0.003) charM = charM * (1.0 - iMisc.x) + chSkin(int(iAnim.z + 0.5), iAnim.w) * iMisc.x;
  }
  charRig = vec3(0.0);
  float rigK = chRigK(int(iAnim.x + 0.5));
  if (iMisc.x > 0.003) rigK = mix(rigK, chRigK(int(iAnim.z + 0.5)), iMisc.x);
  if (charHide < 0.5 && rigK > 0.001 && dot(uRig, uRig) > 1e-9) {
    float wl = 0.0, wr = 0.0;
    for (int k = 0; k < 4; k++) {
      float jj = aJ[k], ww = aW[k];
      if (jj > 13.5 && jj < 37.5) wl += ww; else if (jj > 40.5 && jj < 64.5) wr += ww;
    }
    float sd = wl - wr;
    if (abs(sd) > 0.002) {
      mat4 cm = chBoneAt(int(iAnim.x + 0.5), iAnim.y, 13);
      if (iMisc.x > 0.003) cm = cm * (1.0 - iMisc.x) + chBoneAt(int(iAnim.z + 0.5), iAnim.w, 13) * iMisc.x;
      charRig = mat3(cm) * vec3(sd * uRig.x, abs(sd) * uRig.y, abs(sd) * uRig.z) * rigK;
    }
  }
#ifndef CHAR_DEPTH
  vBind = position;
  vMask = aMask;
  int fl = int(iMisc.w + 0.5);
  vLimb = vec4(aLimb, float(fl & 3), float((fl >> 2) & 1));
  vApp = iMisc.y;
  vPart = aInfo.x;
  vCovered = charCov * uHideCov;
#endif
#ifdef CHAR_VCOL
  vCol = aCol;
#endif
}
`;
const PLACE = /* glsl */`
if (uEyeL.w > 0.5) transformed = chFace(transformed);   // (a crowd head's face in motion)
if (uFootL.w > 0.5) {                                          // a crowd resident's feet: 80-90% (its own, about the ankle)
  float wfl = 0.0, wfr = 0.0;
  for (int k = 0; k < 4; k++) { float jj = aJ[k]; if (jj > 2.5 && jj < 5.5) wfl += aW[k]; else if (jj > 7.5 && jj < 10.5) wfr += aW[k]; }
  if (wfl + wfr > 0.001) {
    float fs = 0.94 + chAppI(int(iMisc.y + 0.5), 7).r * 0.12;
    vec3 fc = wfl > wfr ? uFootL.xyz : uFootR.xyz, fq = transformed;
    fq.xz = fc.xz + (fq.xz - fc.xz) * fs;
    transformed = mix(transformed, fq, min(1.0, wfl + wfr));
  }
}
if (aInfo.x > 10.5) {
  transformed.y = aLimb.x - (aLimb.x - transformed.y) * charLid;
  // The added pack's measured V3 lids use category7 and a per-vertex
  // partial-blink clearance envelope. Legacy category0 lids stay exact.
  if (aInfo.y > 6.5 && aInfo.y < 7.5)
    transformed.z += max(aInfo.z, 0.0) * sqrt(max(0.0, sin(charLid * 3.14159265)));
}
transformed -= normal * (charShrink - uPush);
transformed = (charM * vec4(transformed, 1.0)).xyz + charRig;
transformed.yz += charSeat * uSeatFix.xy;   // (a builder body sat as the seats were fitted to: render/seat-fix.js)
transformed.xz *= charH * charB;
{ float pv = charSeat * uSeatFix.z; transformed.y = (transformed.y - pv) * charH + pv; }   // (seated: its height about the seat)
transformed = chRot(transformed) + iPos.xyz;
if (charHide > 0.5) transformed = vec3(0.0, -1000.0, 0.0);`;

// Fragment colour: every surface is real geometry (body, garments, hair); the part id picks the appearance colour.
// (a function: with the old light, ?light=0, the text the old light had: render/light.js)
const FRAG_PARS = () => /* glsl */`
${COMMON}
varying vec3 vBind;
varying vec4 vMask;
uniform float uShade;
varying vec4 vLimb;
flat varying float vApp;
flat varying float vPart;
// (a crowd body's skin under the clothes worn: 1 at each of its vertices so covered. Wholly 1 across a triangle — every
// corner under them, as the character builder drops it — it is not drawn; where it meets bare skin, drawn and pulled in)
varying float vCovered;
#ifdef CHAR_VCOL
varying vec4 vCol;
vec3 chLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
// (a crowd part's vertex that follows one of its resident's colours: 1 skin, 2 hair, 3 eyes, 4 top, 5 bottoms, 6 shoes)
uniform vec3 uTint[7];
vec3 chTint() {
  int k = int(vMask.x * 255.0 + 0.5);
  if (k == 0) return vec3(1.0);
  int a = int(vApp + 0.5);
  vec3 c = chAppI(a, k == 1 ? 0 : k == 2 ? 1 : k == 3 ? 6 : k == 4 ? 2 : k == 5 ? 3 : 4).rgb;
  return min(chLinear(c) / max(uTint[k], vec3(0.02)), vec3(4.0));
}
#endif
${LIGHT.on ? `varying vec3 vWP;
uniform float uIndoor, uNight;
${ROOM_PARS}
${STREET_PARS}` : 'uniform float uIndoor;'}
uniform vec4 uLand;   // waist, neck joint y
float aa(float d, float w) { float e = fwidth(d) + 1e-5; return 1.0 - smoothstep(w - e, w + e, d); }
vec3 charDetail(int part, vec3 c, int a) {
  vec3 p = vBind;
  int ts = chSty(chAppI(a, 2).a), bs = chSty(chAppI(a, 3).a);
  if (part == 3 && bs != 2) {                                  // belt + buckle
    float belt = aa(abs(p.y - (uLand.x - 0.004)), 0.011);
    c = mix(c, chAppI(a, 5).rgb * 0.55, belt);
    c = mix(c, vec3(0.78, 0.72, 0.55), belt * aa(abs(p.x), 0.017) * step(0.0, p.z));
    if (bs == 3) c = mix(c, c * 0.72, aa(abs(abs(p.x) - 0.105), 0.0022) * step(p.y, uLand.x - 0.05));   // jeans seam
  }
  if (part == 4) c = mix(c, vec3(0.93, 0.92, 0.89), aa(p.y, 0.027));                 // sole
  if (part == 2 && p.z > 0.0) {
    if (ts == 2) {                                             // button shirt: placket + buttons
      c = mix(c, c * 0.82, aa(abs(p.x), 0.006));
      float by = mod(p.y - uLand.x, 0.072) - 0.036;
      c = mix(c, vec3(0.94), aa(length(vec2(p.x, by)), 0.0042));
    } else if (ts == 3) {                                      // blazer: shirt in the V + lapel edge
      float v = (p.y - (uLand.x + 0.1)) * 0.42;
      float open = step(uLand.x + 0.1, p.y) * aa(abs(p.x), v);
      float lapel = step(uLand.x + 0.1, p.y) * aa(abs(p.x), v + 0.022) * (1.0 - open);
      c = mix(c, c * 0.8, lapel);
      c = mix(c, vec3(0.95, 0.95, 0.93), open);
    } else if (ts == 4) {                                      // hoodie drawstrings
      float ds = aa(abs(abs(p.x) - 0.035), 0.0028) * step(uLand.y - 0.14, p.y) * step(p.y, uLand.y - 0.01);
      c = mix(c, vec3(0.92), ds);
    }
  }
  return c;
}
vec3 charPaint() {
  int a = int(vApp + 0.5);
  int part = int(vPart + 0.5);
  vec3 skin = chAppI(a, 0).rgb;
  if (part == 0) return skin;
  if (part == 1) return chAppI(a, 1).rgb;
  if (part == 2) return charDetail(2, chAppI(a, 2).rgb, a);
  if (part == 3) return charDetail(3, chAppI(a, 3).rgb, a);
  if (part == 4) return charDetail(4, chAppI(a, 4).rgb, a);
  if (part == 5) return chAppI(a, 5).rgb * 0.8;
  if (part == 6) return vec3(0.92, 0.91, 0.88);
  if (part == 7) return chAppI(a, 2).rgb * 0.72;
  if (part == 8) return vec3(0.95, 0.95, 0.93);
  if (part == 9) return mix(skin, chAppI(a, 1).rgb, 0.3);
  if (part == 10) return chAppI(a, 3).rgb * 0.7;
  return skin;
}
float charRough() {
  int part = int(vPart + 0.5);
  return part == 0 ? 0.62 : part == 1 ? 0.55 : part == 6 ? 0.7 : part == 4 ? 0.6 : 0.88;
}
`;
// The light on a person (render/light.js): indoors the room's (vLimb.w: on the floor looked into), out of doors after dark
// the street lamps' and a cool edge; selected or hovered: outlined instead (render/outline.js)
const RIM = () => LIGHT.on ? /* glsl */`
if (vLimb.w > 0.5) totalEmissiveRadiance += diffuseColor.rgb * 0.5 * roomLight(normal, vWP, uNight);
else if (uNight > 0.01) totalEmissiveRadiance += diffuseColor.rgb * streetLight(normal, vWP, uNight) + nightRim(normal, uNight);
` : /* glsl */`
totalEmissiveRadiance += diffuseColor.rgb * uIndoor * vLimb.w * 0.45;
`;

// ------------------------------------------------------------------------------------------------ renderer
export class Characters {
  /** warmAll: load every character in the background (the Customizer's roster), else only those that someone wears
   *  (setAppearance / ensureKind). normalSize: the normal maps' size (phones: half the colour map's). concurrency: how
   *  many characters download and decode at once. */
  constructor({ capacity = 4096, lods = [0, 1, 2], shadows = true, renderer = null, mapSize = 2048, normalSize = mapSize, warmAll = true, concurrency = 4, crowd = CROWD } = {}) {
    this.cap = 0;
    this.crowdOn = crowd;   // (the crowd drawn from parts: CROWD, or the Crowd Studio's own)
    this.close = false;     // (the one push()ed now is among the nearest the camera: render/agents.js, Character detail)
    this.tuckU = { value: 0.014 }; this.hideU = { value: 1 }; this.pushU = {};
    this.seatClipsU = { value: typeof seatClipBits === 'function' ? seatClipBits() : [0, 0, 0] };   // (shared with what they hold: render/char-props.js; lab checks empty it to compare) this.tuning = null;   // (the crowd's tuning, once here: crowdTuning)
    // With a renderer, a loaded model's maps and animation texture go to the GPU in spare frame time (stepped from
    // begin()) before its meshes appear, instead of all inside the frame that first draws it.
    this.renderer = renderer; this.uploads = []; this.uploaded = new WeakSet(); this.mapSize = mapSize; this.normalSize = normalSize; this.skip = 0;
    this.shadows = shadows;
    this.lodIds = lods;
    this.group = new THREE.Group();
    this.appUniform = { value: null };
    this.indoor = { value: 0 };
    // the floor looked into (render/light.js): its height and its light map (render/room-light.js), set by main.js
    this.roomU = { value: [-1e6, 0.75, 0, 0] }; this.roomMap = { value: null }; this.roomXf = { value: [0, 0, 1, 0] }; this.roomBox = { value: [0, 0, 1, 1] };
    // the street lamps' light maps (render/city.js, render/island-roads.js), set by main.js
    this.lampMap = { value: null }; this.lampRect = { value: [-1e7, -1e7, 1, 1] }; this.lampMap2 = { value: null }; this.lampRect2 = { value: [-1e7, -1e7, 1, 1] };
    this.night = { value: 0 };   // (the held screens glow at night: render/char-props.js)
    this.uTime = { value: 0 };
    this.lidForce = { value: -1 };
    // Separate original A-pose and newer T-pose calibrations. Legacy aliases
    // still address Batch1 only; saved production profiles control each group.
    const pair = () => ({ male: { value: new THREE.Vector3() }, female: { value: new THREE.Vector3() } });
    this.rigBatchU = { batch1: pair(), batch2: pair() };
    this.rigU = this.rigBatchU.batch1;
    this.rigReady = this.loadRig();
    this.uniforms = { uIndoor: this.indoor, uApp: this.appUniform, uNight: this.night, uRoom: this.roomU, uRoomMap: this.roomMap, uRoomXf: this.roomXf, uRoomBox: this.roomBox,
      uLightMap: this.lampMap, uLightRect: this.lampRect, uLightMap2: this.lampMap2, uLightRect2: this.lampRect2 };
    this.props = new CharProps(this.group, { ...this.uniforms, uSeatClips: this.seatClipsU }, shadows);
    this.appData = null;
    this.kindOf = new Uint8Array(0);
    // the crowd (CROWD): each resident's look and parts (undefined: not one of the crowd; null: its parts not picked yet)
    this.crowdOf = []; this.crowdApp = []; this.crowdMan = {};
    if (this.crowdOn) {
      for (const sex of ['f', 'm']) crowdManifest(sex).then(m => { this.crowdMan[sex] = m; }).catch(err => console.error('the crowd\'s library failed to load', err));
      crowdTuning().then(t => this.useTuning(t));   // (its parts and fit; its faces' motion and the blink's pace)
    }
    this.kinds = [];           // per kind: { data, lods: [{ L, g, mesh, ... }], mats }
    // instance staging per (kind, lod), filled by push() even before the meshes exist
    // (each sized for the people actually drawn with that character at that detail, and doubled when more are: sized for
    // every possible person, 12032, the 129 meshes' buffers were ~74 MB of zeros sent to the GPU at the first frame —
    // 4.5 s of the phone's loading screen, 2026-10-04)
    const room0 = 256;   // (instances each character's mesh at each detail starts with room for)
    this.stage = KINDS.map(() => lods.map(() => ({ P: new Float32Array(room0 * 4), An: new Float32Array(room0 * 4), M: new Float32Array(room0 * 4), n: 0, cap: room0 })));
    this.lods = lods.map(() => ({ tris: 0 }));
    this.tableTop = null;  // (x, z, highest) → the top of the table there (m, world) or null: set by main.js (render/interiors.js)
    this.hl = [];          // this frame's selected and hovered people: { kind, j, at (their slot in the staging), sel }
    this.masks = [];       // their outline's own meshes (outlineDraw), one each
    this.grow(capacity);
    // The Customizer warms the complete roster in the background (no character waits for a first click to begin
    // downloading); the world loads only the characters someone wears (2026-10-04, the phone slowed right down after
    // loading: all 44 were fetched, ~350 MB, and kept on the GPU, though the residents wear 24). Current residents and
    // explicit selections get priority. An explicit ?only= list still limits diagnostics.
    this.demand = new Uint32Array(KINDS.length);
    this.near = new Float32Array(KINDS.length);   // (how much someone on screen waited for each model: push, below)
    const todo = [];
    const pending = new Map();
    const complete = new Map();
    let active = 0, failed = null, initialDone = false, readyResolve;
    this.ready = new Promise(resolve => { readyResolve = resolve; });
    const queue = k => {
      if (this.kinds[k]) return Promise.resolve(this.kinds[k]);
      if (!wanted(KINDS[k])) return Promise.resolve(null);
      if (pending.has(k)) return pending.get(k);
      const promise = new Promise(resolve => complete.set(k, resolve));
      pending.set(k, promise); todo.push(k); return promise;
    };
    const start = k => {
      active++;
      // (its maps go up one at a time, then the model itself appears as a step of its own: its first draw sends its
      // mesh to the GPU, kept out of a frame that also uploads a map — stepUploads paces them all; the page's own
      // player's go first, unpaced: queue below)
      loadKind(KINDS[k], this.mapSize, this.normalSize).then(d => this.upload(d, this.hurry.has(k))).then(d => (!this.renderer ? this.initKind(k, d) : new Promise((res, rej) => this.queueUpload(() => {
        try { this.initKind(k, d); res(d); } catch (err) { rej(err); }
      }, this.hurry.has(k))))).then(() => {
        this.loadedCount = (this.loadedCount || 0) + 1;
        complete.get(k)(this.kinds[k]);
      }).catch(err => {
        failed = this.loadError = err; complete.get(k)(null);
        console.error('character assets failed to load', KINDS[k], err);
      }).finally(() => {
        active--; pump();
        if (!active && !todo.length && !initialDone) {
          initialDone = true; if (!failed) this.loaded = true; readyResolve();
        }
      });
    };
    const pump = () => {
      while (active < concurrency && todo.length) {
        todo.sort((a, b) => this.near[b] - this.near[a] || this.demand[b] - this.demand[a] || a - b);   // (on screen first, then the most worn)
        start(todo.shift());
      }
    };
    // now: a model that starts at once, beside the ones on their way, and goes up to the GPU before theirs (the page's own
    // player's body: setAppearance first)
    this.hurry = new Set();
    this.ensureKind = (name, now = false) => {
      const k = typeof name === 'number' ? name : kindIndex(name);
      if (k < 2 || k >= KINDS.length) return Promise.resolve(null);
      this.fit(k);
      if (now) this.hurry.add(k);
      const promise = queue(k), j = now ? todo.indexOf(k) : -1;
      if (j >= 0) { todo.splice(j, 1); start(k); }
      pump(); return promise;
    };
    if (warmAll) KINDS.forEach((kind, k) => {
      if (wanted(kind)) queue(k);
    });
    pump();
    if (!active && !todo.length) { initialDone = this.loaded = true; readyResolve(); }
    this.loading = () => active > 0 || todo.length > 0;
  }
  /**
   * At load, behind the loading screen (render: main.js, before the shaders are compiled): the models that have arrived
   * go up now, all of them, rather than one a frame once the world shows — where the pacing (stepUploads) waits for calm
   * frames, and a phone's first frames are anything but (2026-11-24: its residents appeared 6 s after the world, their
   * library there for 7 s already). The models still arriving are waited for while they keep coming (each within
   * `quietMs` of the last), up to `budgetMs` in all; what comes later goes up paced, as before.
   */
  async settle({ budgetMs = 2500, quietMs = 300 } = {}) {
    const t0 = performance.now();
    let last = t0;
    for (;;) {
      const now = performance.now();
      // (models going up now; a model's finer detail swapped in, refineKind, waits for the paced uploads)
      const now2 = this.uploads.filter(f => !f.refine);
      if (now2.length) { this.uploads = this.uploads.filter(f => f.refine); for (const f of now2) f(); last = now; }
      else if (!this.loading() || now - last > quietMs) break;
      if (now - t0 > budgetMs) break;
      await new Promise(r => setTimeout(r, 0));   // (the loads waiting on those uploads move on: pump)
    }
    this.lastUpload = performance.now();
  }
  /** The arm calibration (rig.json: the ready-made Tripo models' arms, set in the rig tool) a model is drawn with: none
   *  for a character made in the builder or the crowd's (2026-11-19: on the builder's bodies it pushed what lies near the
   *  shoulders 3.6 cm out and 2.6 cm up, skin and shirt by different amounts — cut through at the collar and the upper
   *  back, the shoulders raised like a hunch; their clips are fitted to their own bodies, nothing to calibrate). */
  rigFor(kind, d) {
    if (isCustomChar(kind) || isCrowdKind(kind)) return (this.noRig ??= { value: new THREE.Vector3() });
    return this.rigBatchU[rigBatchForKind(kind, d.man)][sexOf(kind, d.man) === 'f' ? 'female' : 'male'];
  }
  setRig(body, w, h, f, batch = 'batch1') {
    const uniform = this.rigBatchU[batch]?.[body];
    if (!uniform) throw new Error('Unknown rig batch/body');
    uniform.value.set(w, h, f);
  }
  loadRig() {
    return fetch('/assets/chars/rig.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => {
      const settings = normalizeRigSettings(j);
      for (const batch of RIG_BATCHES) for (const body of RIG_BODIES) {
        const p = settings.batches[batch][body];
        this.setRig(body, p.width, p.height, p.forward, batch);
      }
      return settings;
    }).catch(() => normalizeRigSettings());
  }
  makeMaterial(kind, d, depth, withMap, mask = false) {
    // vc: a built character, coloured per vertex (its normal map where the base body's skin shows)
    const vc = !!d.man.vcol, tx = !!d.colorMap && !vc, cover = !depth && !mask && hidesSkin(kind);
    const U = {
      uAnim: { value: d.tex }, uClip: { value: d.clip },
      uApp: this.appUniform, uIndoor: this.indoor, uNight: this.night, uRoom: this.roomU, uRoomMap: this.roomMap, uRoomXf: this.roomXf, uRoomBox: this.roomBox, uLightMap: this.lampMap, uLightRect: this.lampRect, uLightMap2: this.lampMap2, uLightRect2: this.lampRect2, uTime: this.uTime, uLidForce: this.lidForce, uRig: this.rigFor(kind, d),
      uLand: { value: new THREE.Vector4(d.man.land.waist, d.man.land.neckY ?? d.man.land.neck, 0, 0) },
      uPush: this.pushUniform(kind, d), uTuck: this.tuckU, uHideCov: this.hideU, uSeatClips: this.seatClipsU, uSeatFix: { value: typeof seatFix === 'function' ? seatFix(d.man) : [0, 0, 0, 0] }, ...this.faceUniforms(), uEyeL: this.eyeUniform(kind, d, 0), uEyeR: this.eyeUniform(kind, d, 1),
      uShade: { value: d.man?.light ? 1 : 0 },   // (its col.a packed: the normal map's flag in bit 0)
      uFootL: { value: d.feet ? new THREE.Vector4(...d.feet.L, 1) : (this.noFeet ??= new THREE.Vector4()) }, uFootR: { value: d.feet ? new THREE.Vector4(...d.feet.R, 1) : (this.noFeet ??= new THREE.Vector4()) },
      // (a crowd part's tints' references; any other model coloured per vertex: none — all ones)
      uTint: { value: d.tint || (vc ? (this.oneTint ??= Array.from({ length: 7 }, () => new THREE.Vector3(1, 1, 1))) : null) },
    };
    if (mask) {
      // (render/outline.js: the body alone, in the mask's colour — its shape as its shadow has it)
      const m = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, fog: false });
      m.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, U, { uMaskCol: MASK_COL });
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n#define CHAR_DEPTH\n' + VERT_PARS)
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ncharCompute();' + PLACE);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uMaskCol;')
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor = vec4(uMaskCol, 1.0);');
      };
      m.customProgramCacheKey = () => 'mvw-tripo-mask';
      if (twoSided(kind)) m.side = THREE.DoubleSide;
      return m;
    }
    const m = depth ? new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
      : new THREE.MeshStandardMaterial({ roughness: tx || vc ? 0.8 : 0.74, metalness: 0, map: tx ? d.colorMap : null, normalMap: withMap ? d.normalMap : null });
    if (twoSided(kind)) m.side = THREE.DoubleSide;
    if (!depth && withMap && d.normalMap) m.normalScale = new THREE.Vector2(1, -1);   // glTF normal maps without tangents: flip green (as GLTFLoader does)
    (m.userData ??= {}).U = U;   // (its uniforms: lab checks turn its shading off and on — tools-bin/crowd-check.mjs --toggle)
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      // (the world position only where the new light reads it: the shadow's shader keeps its old text, render/light.js)
      let v = sh.vertexShader.replace('#include <common>', '#include <common>\n' + (depth ? '#define CHAR_DEPTH\n' : LIGHT.on ? 'varying vec3 vWP;\n' : '') + (vc && !depth ? '#define CHAR_VCOL\n' : '') + VERT_PARS);
      if (depth) v = v.replace('#include <begin_vertex>', '#include <begin_vertex>\ncharCompute();' + PLACE);
      else {
        v = v.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\ncharCompute();\nobjectNormal = chRot(mat3(charM) * objectNormal);')
          .replace('#include <begin_vertex>', '#include <begin_vertex>' + PLACE)
          .replace('#include <project_vertex>', LIGHT.on ? '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;' : '#include <project_vertex>');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + (vc ? '#define CHAR_VCOL\n' : '') + FRAG_PARS());
        if (cover) sh.fragmentShader = sh.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vCovered > 0.995) discard;');
        if (vc) sh.fragmentShader = sh.fragmentShader
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = min(diffuseColor.rgb * chLinear(vCol.rgb) * chTint(), vec3(1.0));')
          .replace('#include <normal_fragment_maps>', 'if (uShade > 0.5 ? mod(floor(vCol.a * 255.0 + 0.5), 2.0) > 0.5 : vCol.a > 0.5) {\n#include <normal_fragment_maps>\n}');
        else if (!tx) sh.fragmentShader = sh.fragmentShader
          .replace('#include <color_fragment>', 'diffuseColor.rgb *= charPaint();')
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = charRough();')
          .replace('#include <normal_fragment_maps>', 'if (vPart < 0.5) {\n#include <normal_fragment_maps>\n}');
        if (tx) sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nif (vPart > 10.5) diffuseColor.rgb = mix(diffuseColor.rgb * 0.92, vec3(0.03, 0.02, 0.02), smoothstep(0.86, 0.97, vLimb.y));')
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + RIM())
          .replace('#include <aomap_fragment>', LIGHT.on ? '#include <aomap_fragment>\nif (vLimb.w > 0.5) reflectedLight.indirectDiffuse *= roomShade(vWP, uNight);' : '#include <aomap_fragment>');
      }
      sh.vertexShader = v;
    };
    // Bone/paint/shading code is identical between model IDs. Share programs
    // by actual shader variant, not by filename, avoiding a compile hitch for
    // every new Customizer choice. Per-material uniforms remain independent.
    m.customProgramCacheKey = () => `mvw-tripo-${vc ? 'vcol' : tx ? 'textured' : 'painted'}-${depth ? 'd' : withMap ? 'n' : 'p'}${depth ? '' : LIGHT.on}${cover ? '-cover' : ''}`;
    return m;
  }
  upload(d, hurry = false) {
    const pending = this.renderer ? [d.colorMap, d.normalMap, d.tex].filter(t => t && !this.uploaded.has(t)) : [];
    if (!pending.length) return d;
    let left = pending.length;
    return new Promise(resolve => pending.forEach(t => this.queueUpload(() => {
      try { this.renderer.initTexture(t); } catch (err) { console.error('character texture upload failed', err); }
      this.uploaded.add(t);
      if (--left === 0) resolve(d);
    }, hurry)));
  }
  /** One step for the GPU (stepUploads): hurry — the page's own player's body — before the others and not held back by
   *  the pacing (2026-11-25: its model was here in 5 s, then waited ~90 s behind the crowd's parts' uploads). */
  queueUpload(f, hurry = false) {
    if (!hurry) { this.uploads.push(f); return; }
    f.hurry = true;
    const i = this.uploads.findIndex(x => !x.hurry);
    if (i < 0) this.uploads.push(f); else this.uploads.splice(i, 0, f);
  }
  /**
   * Stand-ins for the characters' shaders — the clothed body (colour map, and normal map when they load one) and its
   * shadow's depth — to compile with the world's at load (render: main.js). The characters arrive after the loading
   * screen, and compiling their shader then held a frame 130–400 ms on the phone (2026-10-04). Kept afterwards, so
   * three.js keeps the programs for the real characters. (Their shadow's: standIns.)
   */
  warmGroup() {
    const tex = cs => { const t = new THREE.DataTexture(new Uint8Array(4), 1, 1); t.colorSpace = cs; t.needsUpdate = true; return t; };
    const anim = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType); anim.needsUpdate = true;
    const d = this.warmD = { tex: anim, off: new Float32Array(NCL), len: new Float32Array(NCL), clip: packClips(new Float32Array(NCL), new Float32Array(NCL)), man: { land: { waist: 1, neck: 1.5 } }, colorMap: tex(THREE.SRGBColorSpace), normalMap: this.normalSize ? tex(THREE.NoColorSpace) : null };
    const g = new THREE.Group(), geo = new THREE.PlaneGeometry(0.01, 0.01);
    for (const m of [this.makeMaterial('f01', d, false, true)]) { const mesh = new THREE.Mesh(geo, m); mesh.frustumCulled = false; mesh.position.y = -9999; g.add(mesh); }
    this.warmKept = g;
    return g;
  }
  /** Stand-ins for their shadows (render/warm.js: as the shadow pass draws them, their depth material with their colour
   *  map, compiled at load) and for what they hold (render/char-props.js). After warmGroup. */
  standIns(out) {
    const d = this.warmD;
    standIns(this.makeMaterial('f01', d, false, true), { depth: this.makeMaterial('f01', d, true, false) }, out);
    return this.props.standIns(out);
  }
  /** A loaded model to draw someone with while theirs loads: the first loaded of the same build (women f…, men m…),
   *  else any loaded one, else -1. */
  standInFor(k) {
    const g = KINDS[k] ? sexOf(KINDS[k]) : 'm', o = this.standIns || (this.standIns = {});
    if (o[g] != null && this.kinds[o[g]]) return o[g];
    // (never a crowd model: a body without its parts, or a part alone)
    for (let j = 2; j < KINDS.length; j++) if (this.kinds[j] && !isCrowdKind(KINDS[j]) && sexOf(KINDS[j], this.kinds[j].d?.man) === g) return (o[g] = j);
    for (let j = 2; j < KINDS.length; j++) if (this.kinds[j] && !isCrowdKind(KINDS[j])) return j;
    return -1;
  }
  initKind(k, d) {
    const kind = KINDS[k];
    const mats = { map: this.makeMaterial(kind, d, false, true), plain: this.makeMaterial(kind, d, false, false), depth: this.makeMaterial(kind, d, true, false) };
    const lods = this.lodIds.map((L, j) => {
      const base = d.lods[Math.min(L, d.lods.length - 1)];
      if (!this.lods[j].tris) this.lods[j].tris = base.userData.tris;
      return this.makeLod(k, j, L, base, mats);
    });
    this.kinds[k] = { d, mats, lods };
    // (a crowd part drawn from the split library's far file: its finest level put in place when the near file comes)
    if (d.refine) d.refine.then(full => { const up = () => this.refineKind(k, full); up.refine = true; this.uploads.push(up); }).catch(err => {
      if (!this.refineFailed) { this.refineFailed = true; console.warn('the crowd\'s close-by detail failed to load', err); }
    });
    // (a character built in the Agent Studio: its face moves as the tuning says, the crowd shown or not)
    if (isCustomChar(kind) && !this.crowdOn && !this.tuningAsked) { this.tuningAsked = true; crowdTuning().then(t => this.useTuning(t)); }
    if (!isCrowdPart(kind)) this.props.initKind(k, d, this.rigFor(kind, d));
  }
  /** Crowd model k's own levels, all of them (`full`), in place of the stand-ins it was drawn with: each detail whose
   *  model changes takes the new one's buffers into the geometry it has (its instances' stay; the stand-in's buffers,
   *  shared with the coarser detail, are left alone — nothing sent to the GPU again), one model a step (stepUploads). */
  refineKind(k, full) {
    const kd = this.kinds[k]; if (!kd || kd.d.lods === full) return;
    kd.d.lods = full; kd.refined = true;
    for (const l of kd.lods) {
      const base = full[Math.min(l.L, full.length - 1)], g = l.g;
      if (g.index === base.index) continue;
      g.setIndex(base.index);
      for (const name of Object.keys(g.attributes)) if (!g.attributes[name].isInstancedBufferAttribute && !base.attributes[name]) g.deleteAttribute(name);
      for (const [name, attr] of Object.entries(base.attributes)) g.setAttribute(name, attr);
      for (const m of this.masks) if (m?.userData.src === g) m.userData.src = null;   // (its outline's copy made again: outlineDraw)
    }
  }
  makeLod(k, j, L, base, mats) {
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(base.index);
    for (const [name, attr] of Object.entries(base.attributes)) g.setAttribute(name, attr);
    const st = this.stage[k][j];
    const mk = arr => { const a = new THREE.InstancedBufferAttribute(arr, 4); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const iPos = mk(st.P), iAnim = mk(st.An), iMisc = mk(st.M);
    g.setAttribute('iPos', iPos); g.setAttribute('iAnim', iAnim); g.setAttribute('iMisc', iMisc);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-1e6, -1e6, -1e6), new THREE.Vector3(1e6, 1e6, 1e6));
    const mesh = new THREE.Mesh(g, base.attributes.uv ? mats.map : mats.plain);
    mesh.frustumCulled = false;
    mesh.castShadow = this.shadows && L < 2 && castsShadow(KINDS[k]); mesh.userData.smallCaster = true;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = mats.depth;
    mesh.renderOrder = 1;
    this.group.add(mesh);
    return { L, g, mesh, iPos, iAnim, iMisc };
  }
  /** Make room for at least n agents (instance buffers + appearance texture). */
  grow(n) {
    if (n <= this.cap) return;
    const cap = Math.max(256, Math.ceil(n / 128) * 128);
    const rows = cap / 128;
    const data = new Uint8Array(1024 * rows * 4);
    if (this.appData) data.set(this.appData.subarray(0, Math.min(this.appData.length, data.length)));
    this.appData = data;
    const tex = new THREE.DataTexture(data, 1024, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false; tex.needsUpdate = true;
    if (this.appTex) this.appTex.dispose();
    this.appTex = tex; this.appUniform.value = tex;
    const ko = this.kindOf; this.kindOf = new Uint16Array(cap); this.kindOf.set(ko.subarray(0, Math.min(ko.length, cap)));
    this.cap = cap;
  }
  /** Room for character model k's own staging and counts (a built character joins KINDS when a look first names it). */
  fit(k) {
    while (this.stage.length <= k) this.stage.push(this.lodIds.map(() => ({ P: new Float32Array(256 * 4), An: new Float32Array(256 * 4), M: new Float32Array(256 * 4), n: 0, cap: 256 })));
    if (this.demand && this.demand.length <= k) {
      const n = Math.max(KINDS.length, k + 1) + 16, d = new Uint32Array(n), r = new Float32Array(n);
      d.set(this.demand); r.set(this.near); this.demand = d; this.near = r;
    }
  }
  /** Room for one more instance of character `kind` at detail `j`: its staging doubles, and its mesh is rebuilt round it. */
  room(kind, j) {
    const s = this.stage[kind]?.[j]; if (!s) return null;
    if (s.n < s.cap) return s;
    if (s.cap >= this.cap) return null;
    const cap = Math.min(this.cap, s.cap * 2), more = a => { const b = new Float32Array(cap * 4); b.set(a); return b; };
    s.P = more(s.P); s.An = more(s.An); s.M = more(s.M); s.cap = cap;
    const kd = this.kinds[kind];
    if (kd) { const l = kd.lods[j]; this.group.remove(l.mesh); l.g.dispose(); kd.lods[j] = this.makeLod(kind, j, l.L, kd.d.lods[Math.min(l.L, kd.d.lods.length - 1)], kd.mats); }
    return s;
  }
  /**
   * How character `app` sits in seated clip `clip` (tools/chars/extra-clips.mjs seatedOf, in venue-clips.json: its own
   * mesh's contact with the seat, top, back, hip joint, soles, toes, wheel held — root space, a body of height 1), with its
   * height and build: { m, H, B }; for the model it is drawn as now (a stand-in while its own loads). Null until known.
   */
  seatedFit(app, clip) {
    if (!this.seatedData) { if (!this.seatedAsk) this.seatedAsk = extraClips('venue').then(j => { this.seatedData = j?.seated || {}; }).catch(() => { this.seatedData = {}; }); return null; }
    let kind = app < this.kindOf.length ? this.kindOf[app] : 0;
    if (!this.kinds[kind]) kind = this.standInFor(kind);
    const m = kind >= 0 ? (this.kinds[kind]?.d.man.seated || this.seatedData[KINDS[kind]])?.[clip] : null;
    if (!m || !this.appData) return null;
    const base = (app >> 7) * 4096 + (app & 127) * 32;
    return { m, H: 0.8 + (this.appData[base + 3] / 255) * 0.4, B: 0.8 + (this.appData[base + 27] / 255) * 0.45 };
  }
  setShadows(on) { this.shadows = on; this.kinds.forEach((kd, k) => { if (kd) for (const l of kd.lods) l.mesh.castShadow = on && l.L < 2 && castsShadow(KINDS[k]); }); this.props.setShadows(on); }
  /** crowd: a resident the crowd may draw (render/agents.js: not an agent shown as one, not a player) — with CROWD, it is
   *  drawn from the crowd's parts unless its look is a character built in the Agent Studio. first: a player's own body
   *  (render/agents.js: 2 the page's own player, 1 the others) — its model loaded before anyone else's. */
  setAppearance(i, app, crowd = false, first = 0) {
    if (i >= this.cap) this.grow(i + 1);
    packAppearance(app, this.appData, (i >> 7) * 4096 + (i & 127) * 32);
    this.crowdOf[i] = undefined;
    if (this.crowdOn && crowd && !isCustomChar(app?.char)) {
      const ck = crowdKind(`crowd_${app?.body ? 'f' : 'm'}`);
      this.kindOf[i] = ck; this.fit(ck);
      this.crowdOf[i] = null; this.crowdApp[i] = app;
      if (this.demand) this.demand[ck]++;
      if (this.ensureKind) this.ensureKind(ck);
      this.appTex.needsUpdate = true;
      return;
    }
    const ck = kindIndex(app && app.char ? app.char : defaultChar(app || {}), !!app?.body);
    this.kindOf[i] = ck >= 2 ? ck : KINDS.indexOf(defaultChar(app || {}));
    this.fit(this.kindOf[i]);
    if (this.demand) this.demand[this.kindOf[i]]++;
    // a player's own body first (2026-11-25, the product owner: "when i go into player mode, the player character turns into
    // a different body ... it should maintain the players same body"): it waited behind the crowd's parts on screen —
    // 97 s in a city of 400, nobody and then another man's model drawn as them meanwhile. The page's own player's starts at
    // once (beside the ones on their way: ensureKind now), the other players' next in the queue
    if (first && this.near) this.near[this.kindOf[i]] = Math.max(this.near[this.kindOf[i]], first * 1e9);
    if (this.ensureKind) this.ensureKind(this.kindOf[i], first === 2);
    this.appTex.needsUpdate = true;
  }
  /** A crowd resident's part models (KINDS indices) at each level of detail ({ 0: […], 1: […], 2: […] }: further away,
   *  each part drawn as a look-alike — the library's far groups), picked once the library's manifest is here (null
   *  before); the garments worn also go into its appearance texels' spare bytes, for the body's skin under them. */
  crowdParts(i) {
    const have = this.crowdOf[i]; if (have) return have;
    const app = this.crowdApp[i], sex = app?.body ? 'f' : 'm', man = this.crowdMan[sex];
    if (!man || !this.tuning) return null;
    const allowed = ((this.crowdAllowed ??= {})[sex] ??= allowedParts(this.tuning, sex, man));
    const counts = Object.fromEntries(CROWD_PARTS.map(c => [c, man.parts[c]?.length || 0]));
    const dresses = (man.parts.top || []).flatMap((p, n) => (p.dress ? [n] : []));
    const r = { feet: 128, ...(this.crowdForced?.get(i) || crowdRecipe(i, app, counts, dresses, allowed)) }, out = { 0: [], 1: [], 2: [] };
    for (const c of CROWD_PARTS) if (r[c] >= 0) for (const L of [0, 1, 2]) {
      const n = L ? man.parts[c][r[c]].far?.[L] ?? r[c] : r[c], k = crowdKind(`crowd_${sex}|${c}|${n}`);
      this.fit(k); out[L].push(k); if (this.ensureKind) this.ensureKind(k);
    }
    // (the close-up level, when this library has one: the body and each part at it — loaded the first time someone is that close)
    if (man.close?.file) {
      out.c = [crowdKind(`crowd_${sex}|body|0|c`)];
      for (const c of CROWD_PARTS) if (r[c] >= 0 && man.parts[c][r[c]]?.close) out.c.push(crowdKind(`crowd_${sex}|${c}|${r[c]}|c`));
      for (const k of out.c) this.fit(k);
    }
    const base = (i >> 7) * 4096 + (i & 127) * 32;
    this.appData[base + 11] = r.top >= 0 ? r.top : 255; this.appData[base + 15] = r.bottom >= 0 ? r.bottom : 255; this.appData[base + 19] = r.shoes >= 0 ? r.shoes : 255;
    this.appData[base + 28] = r.feet;   // (its feet: 0 → 80%, 255 → 90% of the source's — the library's 85% ×0.94…1.06)
    this.appTex.needsUpdate = true;
    this.crowdRecipes ??= []; this.crowdRecipes[i] = r;
    return (this.crowdOf[i] = out);
  }
  /** Lab checks: crowd resident i drawn with these parts ({ head, hair, beard, top, bottom, shoes, feet }), or its own
   *  again (null). */
  crowdLook(i, r) {
    this.crowdForced ??= new Map();
    if (r) this.crowdForced.set(i, r); else this.crowdForced.delete(i);
    if (this.crowdOf[i] !== undefined) this.crowdOf[i] = null;
  }
  /** The faces' motion, the same for every model (the tuning's face, the studio's preview, the clips that talk and smile). */
  faceUniforms() {
    if (!this.faceU) {
      const F = typeof FACE === 'undefined' ? {} : FACE, d = k => F[k]?.[0] ?? 0, bits = names => { const m = [0, 0, 0]; for (const n of names || []) { const c = T[n]; if (c !== undefined && c < 96) m[c >> 5] |= 1 << (c & 31); } return m; };
      this.faceU = {
        uFace: { value: [d('glance') * Math.PI / 180, d('glanceEvery'), d('brow'), d('browEvery')] }, uFace2: { value: [d('smile'), d('smileShare'), d('talk'), d('talkRate')] },
        uFaceForce: { value: [0, 0, 0, 0] }, uFaceForce2: { value: [0, 0, 0, 0] }, uBlinkEvery: { value: F.blinkEvery ? d('blinkEvery') : 4.8 },
        uTalkClips: { value: bits(typeof TALK_CLIPS === 'undefined' ? [] : TALK_CLIPS) }, uSmileClips: { value: bits(typeof SMILE_CLIPS === 'undefined' ? [] : SMILE_CLIPS) },
      };
    }
    return this.faceU;
  }
  setFace(face) {
    const U = this.faceUniforms(), f = face || {};
    U.uFace.value = [(f.glance ?? 0) * Math.PI / 180, f.glanceEvery ?? 3.5, f.brow ?? 0, f.browEvery ?? 7];
    U.uFace2.value = [f.smile ?? 0, f.smileShare ?? 0, f.talk ?? 0, f.talkRate ?? 3];
    U.uBlinkEvery.value = f.blinkEvery ?? 4.8;
  }
  /** The Crowd Studio's preview of a face: { gx, gy (radians), brow, smile, talk (0..1) }, or null (the faces' own motion). */
  setFaceForce(p) {
    const U = this.faceUniforms();
    U.uFaceForce.value = p ? [p.gx || 0, p.gy || 0, p.brow || 0, p.smile || 0] : [0, 0, 0, 0];
    U.uFaceForce2.value = p ? [p.talk || 0, 1, 0, 0] : [0, 0, 0, 0];
  }
  /** A face's eye (0 left, 1 right): its centre (w 1: its face moves), as tools/chars/face-tags.mjs found it; none else. */
  eyeUniform(kind, d, side) {
    const [, cat, n] = isCrowdPart(kind) ? kind.split('|') : [];
    // (a crowd head's, or a character built in the Agent Studio — baked with its face tagged: bake:3)
    const e = cat === 'head' ? d?.man?.parts?.head?.[+n]?.eyes?.[side] : isCustomChar(kind) ? d?.man?.face?.eyes?.[side] : null;
    return e ? { value: [...e, 1] } : (this.noEye ??= { value: [0, 0, 0, 0] });
  }
  /** How far model `kind` is pushed out along its surface (a crowd part: the tuning's, by its name; any other: none). */
  pushUniform(kind, d) {
    if (!isCrowdPart(kind)) return (this.noPush ??= { value: 0 });
    return (this.pushU[kind] ??= { value: this.pushFor(kind, d?.man) });
  }
  pushFor(kind, man) {
    const [, cat, n] = kind.split('|'), name = man?.parts?.[cat]?.[+n]?.name;
    return name ? pushOf(this.tuning, kind[6], cat, name) : 0;
  }
  /** The crowd's tuning (crowdTuning): the skin's tuck, the garments pushed out, the parts worn (each resident's picked
   *  again). Postures are turned as the animations load (rigAnim); the studio turns them again (applyTuning). */
  useTuning(t) {
    this.tuning = t; this.tuckU.value = t.tuck; this.hideU.value = t.hide === false ? 0 : 1; this.crowdAllowed = {};
    this.setFace(t.face);
    for (const [kind, u] of Object.entries(this.pushU)) u.value = this.pushFor(kind, this.crowdMan[kind[6]]);
    this.crowdOf.forEach((v, i) => { if (v) this.crowdOf[i] = null; });
  }
  /** The Crowd Studio: a tuning not yet saved, shown at once — the bodies' postures too (their animations turned again
   *  from the baked ones kept: studioTuning). */
  async applyTuning(src) {
    const t = normalizeTuning(src), prev = this.tuning;
    tuningAsk = Promise.resolve(t);
    this.useTuning(t);
    const same = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});
    for (const sex of ['f', 'm']) {
      if ((same(prev?.rig?.[sex], t.rig?.[sex]) && same(prev?.clips?.[sex], t.clips?.[sex])) || !crowdPacks[sex]) continue;
      const kinds = await crowdPacks[sex], d = kinds[`crowd_${sex}`], anim = d?.anim;
      if (!anim?.src) continue;
      anim.data.set(anim.src); applyRig(anim, t.rig?.[sex], withClipFix(sex, t.clips?.[sex]));
      d.tex.needsUpdate = true;
    }
    return t;
  }
  begin() { this.stepUploads(); for (const s of this.stage.flat()) s.n = 0; this.props.begin(); this.hl.length = 0; }
  /** One upload at most (a map, or a model appearing), after a frame that kept to this device's normal pace (or when
   *  nothing went up for 250 ms), then spaced so uploads average under ~4 ms a frame. Judged against the device's own
   *  typical frame time, so a device that is always a little slower still loads steadily and only spikes are skipped.
   *  The GPU's share (2026-11-02, measured on a phone: an upload costs the main thread ~1 ms, its real cost lands on the
   *  GPU a frame or two later, so they went up back to back and the first half minute hitched ~40 times): the two frames
   *  after each upload are watched — when they come late clearly more often than this device's frames usually do, the
   *  wait before the next doubles (from 2 up to 40 frames); uploads that pass unnoticed bring it back down (to none). */
  stepUploads() {
    if (!this.uploads.length) { this.cool = 0; return; }
    if (this.uploads[0].hurry) { this.uploads.shift()(); this.lastUpload = performance.now(); return; }   // (the own player's body: at once)
    const now = performance.now(), gap = now - (this.lastBegin ?? now); this.lastBegin = now;
    if (gap > 0 && gap < 250 && !(this.watch > 0)) this.typGap = this.typGap ? this.typGap + (gap - this.typGap) * 0.1 : gap;   // (the device's own pace, not an upload's)
    const late = gap > Math.max(24, (this.typGap || 16) * 1.6);
    if (this.watch > 0) {   // (a frame just after an upload: how often those come late, against how often any frame does)
      this.watch--; this.latePost = (this.latePost ?? 0) + ((late ? 1 : 0) - (this.latePost ?? 0)) * 0.2;
      if (late && this.latePost > (this.lateBase ?? 0) + 0.25) { this.cool = Math.min(20, Math.max(2, (this.cool || 0) * 2)); this.skip = Math.max(this.skip, this.cool); this.watch = 0; }
      else if (!this.watch) this.cool = Math.max(0, (this.cool || 0) - 1);
    } else this.lateBase = (this.lateBase ?? 0) + ((late ? 1 : 0) - (this.lateBase ?? 0)) * 0.05;
    if (this.skip > 0) { this.skip--; return; }
    if (gap > Math.max(20, (this.typGap || 0) * 1.25) && now - (this.lastUpload ?? -1e9) < 250) return;
    this.uploads.shift()();
    const end = performance.now(); this.lastUpload = end;
    this.skip = Math.max(this.cool || 0, Math.min(8, Math.floor((end - now) / 4))); this.watch = 2;
  }
  /**
   * A point of a hand's grip frame (tools/chars/extra-clips.mjs: x the index finger's side, y along the fingers, z out of
   * the palm, on the palm) where character `app` has it in MVW clip c at phase u — worked out on the CPU from the same
   * baked frames the shader skins with (the fishing line hangs off the rod's tip, the catch lies in the hands). side:
   * 'R' or 'L'. → [x, y, z] in the body's own frame (before its height, build and turn: bodyToWorld), or null while its
   * model loads. (For the clips that play without the arm calibration — charClips.js TRIPO_EXACT — this is exact.)
   */
  gripPoint(app, c, u, side, p = [0, 0, 0], out = [0, 0, 0]) {
    const kd = this.kinds[app < this.kindOf.length ? this.kindOf[app] : 0], d = kd?.d, gr = d?.grips?.[side];
    if (!d || !gr || !d.tex?.image?.data) return null;
    const bone = (d._hand ??= (() => { const names = d.man.names.map(n => n.replace(/^mixamorig:/, '')); return { R: names.indexOf('RightHand'), L: names.indexOf('LeftHand') }; })())[side];
    const k = OLD2T[c] ?? 0, L = Math.abs(d.len[k]), n = Math.round(L), o = Math.round(d.off[k]);
    if (!(n > 0) || bone < 0) return null;
    const f = (((u % 1) + 1) % 1) * L, f0 = Math.floor(f), t = f - f0;
    // the grip point in the hand's bind space, then the hand's bone at the two frames either side, blended
    const gx = gr[0] * p[0] + gr[1] * p[1] + gr[2] * p[2] + gr[3], gy = gr[4] * p[0] + gr[5] * p[1] + gr[6] * p[2] + gr[7], gz = gr[8] * p[0] + gr[9] * p[1] + gr[10] * p[2] + gr[11];
    const data = d.tex.image.data, half = THREE.DataUtils.fromHalfFloat;
    out[0] = out[1] = out[2] = 0;
    for (const [fr, w] of [[o + (f0 % n), 1 - t], [o + ((f0 + 1) % n), t]]) {
      const i = (fr * 65 + bone) * 3;
      for (let r = 0; r < 3; r++) { const q = (i + r) * 4; out[r] += w * (half(data[q]) * gx + half(data[q + 1]) * gy + half(data[q + 2]) * gz + half(data[q + 3])); }
    }
    return out;
  }
  /** Body `app`'s height and build as drawn (its appearance texels: PLACE's charH, charB) → [height, build]. */
  bodyScale(app) {
    if (!this.appData || !(app < this.cap)) return [1, 1];
    const base = (app >> 7) * 4096 + (app & 127) * 32;
    return [0.8 + (this.appData[base + 3] / 255) * 0.4, 0.8 + (this.appData[base + 27] / 255) * 0.45];
  }
  /** k = lod index into this.lods; cA/cB are MVW clip ids (anim.js CLIP), mapped to Tripo clips here. prop: what they hold
   *  (shared/anims.js PROP), drawn with them up close (render/char-props.js); item: the food or drink item (shared/food.js). */
  push(k, x, y, z, yaw, cA, pA, cB, pB, w, app, prop, flags, item = 0, ghost = false) {
    let kind = app < this.kindOf.length ? this.kindOf[app] : 0;
    // their own model still on its way (2026-11-02: "characters don't show up initially"): drawn meanwhile as one of the
    // same build that has loaded, and their own asked for first — the people on screen before the rest of the city
    if (!this.kinds[kind]) {
      if (this.near) this.near[kind] += k === 0 ? 4 : k === 1 ? 2 : 1;
      kind = this.standInFor(kind);
      if (kind < 0) return;
    }
    // a crowd resident: drawn once all its parts are here (never a body without its clothes)
    const all = this.crowdOf[app] === undefined ? null : this.crowdParts(app);
    let parts = all ? all[this.lodIds[k]] || all[2] : null;
    if (this.crowdOf[app] !== undefined && (!parts || parts.some(pk => !this.kinds[pk]))) { if (parts && this.near) for (const pk of parts) this.near[pk] += 4; return; }
    // one of the few nearest the camera (render/agents.js close: the graphics option Character detail): its close-up level
    // once it is here — asked for now, the near level meanwhile. What they hold goes with their body as the near level
    // draws it: the close-up level's body is a part (no rig of its own for char-props — 2026-11-20: held things gone up close)
    const holder = kind;
    if (this.close && all?.c) {
      if (all.c.every(pk => this.kinds[pk])) { kind = all.c[0]; parts = all.c.slice(1); }
      else if (this.ensureKind) for (const pk of all.c) if (!this.kinds[pk]) { this.ensureKind(pk); if (this.near) this.near[pk] += 4; }
    }
    const s = this.room(kind, k);
    if (!s) return;
    let a = OLD2T[cA] ?? 0, b = OLD2T[cB] ?? 0;
    if (a === DANCE) a += app % 6;
    if (b === DANCE) b += app % 6;
    // standing idle: each builder body's own idles, one per resident (shared/crowd-tuning.js IDLES), played whole cycles
    // in the idle's time (its phase times as many of them as fit)
    if (a === T_IDLE || b === T_IDLE) {
      const iv = this.idleFor(kind, app);
      if (iv) { if (a === T_IDLE) { a = iv[0]; pA *= iv[1]; } if (b === T_IDLE) { b = iv[0]; pB *= iv[1]; } }
    }
    // ghost: the body left out, what it holds or has on the table drawn (a screen being used through its eyes)
    if (!ghost) {
      const o = s.n * 4; s.n++;
      s.P[o] = x; s.P[o + 1] = y; s.P[o + 2] = z; s.P[o + 3] = yaw;
      s.An[o] = a; s.An[o + 1] = pA; s.An[o + 2] = b; s.An[o + 3] = pB;
      s.M[o] = w; s.M[o + 1] = app; s.M[o + 2] = prop; s.M[o + 3] = flags;
      // (selected or hovered: outlined — render/outline.js — all of them: a crowd resident's every part with its body)
      const hl = flags & 3 ? { kind, j: k, at: o, sel: (flags & 3) === 2, parts: [] } : null;
      if (hl) this.hl.push(hl);
      // (its parts: the same instance, in each part's own staging)
      if (parts) for (const pk of parts) {
        const ps = this.room(pk, k); if (!ps) continue;
        const q = ps.n * 4; ps.n++;
        for (let c = 0; c < 4; c++) { ps.P[q + c] = s.P[o + c]; ps.An[q + c] = s.An[o + c]; ps.M[q + c] = s.M[o + c]; }
        if (hl) hl.parts.push(pk, q);
      }
    }
    const shape = prop || item || GEAR_CLIP[cA] ? shapeFor(cA, prop, item) : 0;   // (item: the drink they hold, the dish they eat — shared/food.js; a fishing rod)
    if (shape && this.lodIds[k] < 2 && this.kinds[holder]) {
      // (set down on a table: on the top of the one in front of them — a picnic table, a bar stands higher than a café's)
      if (onTable(shape)) { const r = this.deskRoot(holder, app, x, y, z, yaw, _root); this.props.push(holder, r[0], r[1], r[2], yaw, a, pA, b, pB, w, app, shape, flags); }
      else this.props.push(holder, x, y, z, yaw, a, pA, b, pB, w, app, shape, flags);
    }
  }
  /**
   * Resident app's idle as drawn with model `kind` (a builder body — the crowd's, one built in the Agent Studio): one of
   * its body's idles (IDLES: a woman's three, a man's two), the same for them every time; → [clip, how many of its cycles
   * in one of the idle's], null for any other model (its own idle).
   */
  idleFor(kind, app) {
    const kd = this.kinds[kind], man = kd?.d.man, ready = !man?.custom && /^[mf]\d/.test(KINDS[kind] || '') && tuningNow?.readyMade !== false;
    const g = man?.custom?.gender || (ready ? (KINDS[kind][0] === 'f' ? 'female' : 'male') : null);
    if (!g || typeof IDLES === 'undefined') return null;
    let list = (this.idleSets ??= new Map()).get(kind);
    if (list === undefined) {
      const clips = kd.d.man.clips || [], dur = n => { const c = clips.find(x => x.name === n); return c ? c.dur || Math.abs(c.len) / 30 : 0; }, D = dur('idle') || 12;
      list = (IDLES[g === 'female' ? 'f' : 'm'] || []).filter(n => T[n] !== undefined && dur(n) > 0).map(n => [T[n], Math.max(1, Math.round(D / dur(n)))]);
      if (!list.length) list = null;
      this.idleSets.set(kind, list);
    }
    if (!list) return null;
    return list[((Math.imul(app + 1, 2654435761) >>> 0) >>> 7) % list.length];
  }
  /**
   * How far the table in front of a seated person stands above or below a table's usual height (char-props.js DESK_TOP):
   * the top of the one under their desk point (tableTop(x, z, highest): render/interiors.js), 0 when none is known.
   * app: who (their height and build), kind: their model. back ([m]): set to how far it must come back toward them on that
   * table (its lid clear of a bar's bottles).
   */
  deskLift(kind, app, x, y, z, yaw, back = null) {
    if (back) back[0] = 0;
    const desk = this.props.desks[kind];
    if (!desk || !this.tableTop || !this.appData) return 0;
    const base = (app >> 7) * 4096 + (app & 127) * 32;
    const H = 0.8 + (this.appData[base + 3] / 255) * 0.4, Bd = 0.8 + (this.appData[base + 27] / 255) * 0.45;
    const [px, , pz] = deskPoint(desk, H, Bd), c = Math.cos(yaw), s = Math.sin(yaw);
    if (back) { _far.x = x + px * c + (pz + DESK_LID) * s; _far.z = z - px * s + (pz + DESK_LID) * c; }
    const top = this.tableTop(x + px * c + pz * s, z - px * s + pz * c, y + 1.4, back ? _far : null);
    const lift = top == null ? 0 : top - y - DESK_TOP;
    if (!(lift > -0.3 && lift < 0.45)) return 0;
    if (back) back[0] = _far.back;
    return lift;
  }
  /** Where what is set down on the table in front of a seated person is placed from (out: [x, y, z]): their root, lifted
   *  to the top of the table there and brought back toward them as far as that table needs (deskLift). */
  deskRoot(kind, app, x, y, z, yaw, out) {
    const lift = this.deskLift(kind, app, x, y, z, yaw, _back), b = _back[0];
    out[0] = x - Math.sin(yaw) * b; out[1] = y + lift; out[2] = z - Math.cos(yaw) * b;
    return out;
  }
  /** Direct Tripo clip index variant (showcase / customizer): same as push but clips are TRIPO_CLIPS indices. */
  pushT(k, x, y, z, yaw, tA, pA, tB, pB, w, app, prop = 0, flags = 0) {
    const kind = app < this.kindOf.length ? this.kindOf[app] : 0;
    // (a crowd resident — the Crowd Studio's — once all its parts are here, each part the same instance)
    const all = this.crowdOf[app] === undefined ? null : this.crowdParts(app), parts = all ? all[this.lodIds[k]] || all[2] : null;
    if (this.crowdOf[app] !== undefined && (!parts || parts.some(pk => !this.kinds[pk]) || !this.kinds[kind])) return;
    const s = this.room(kind, k);
    if (!s) return;
    const o = s.n * 4; s.n++;
    s.P[o] = x; s.P[o + 1] = y; s.P[o + 2] = z; s.P[o + 3] = yaw;
    s.An[o] = tA; s.An[o + 1] = pA; s.An[o + 2] = tB; s.An[o + 3] = pB;
    s.M[o] = w; s.M[o + 1] = app; s.M[o + 2] = prop; s.M[o + 3] = flags;
    if (parts) for (const pk of parts) {
      const ps = this.room(pk, k); if (!ps) continue;
      const q = ps.n * 4; ps.n++;
      for (let c = 0; c < 4; c++) { ps.P[q + c] = s.P[o + c]; ps.An[q + c] = s.An[o + c]; ps.M[q + c] = s.M[o + c]; }
    }
  }
  end() {
    this.uTime.value = performance.now() / 1000;
    this.props.end();
    this.kinds.forEach((kd, k) => {
      if (!kd) return;
      kd.lods.forEach((l, j) => {
        const n = this.stage[k][j].n;
        l.g.instanceCount = n;
        l.mesh.visible = n > 0;   // 132 kind/LOD meshes: empty ones skip both render passes entirely
        if (!n) return;
        for (const a of [l.iPos, l.iAnim, l.iMisc]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
      });
    });
  }
  /** The selected and hovered people drawn alone, for their outline (render/outline.js): a mesh each for their body and,
   *  a crowd resident, each of its parts (head, hair, clothes, shoes) at the detail they are drawn at, with just their
   *  instance — the outline round the whole of them, its outer edge (2026-11-20: the clothes, head and hair were left out). */
  outlineDraw(draw) {
    let n = 0;
    const one = (kind, j, at, sel) => {
      const kd = this.kinds[kind]; if (!kd) return;
      kd.mask ??= this.makeMaterial(KINDS[kind], kd.d, false, false, true);
      const l = kd.lods[j], st = this.stage[kind][j];
      let m = this.masks[n];
      if (!m || m.userData.src !== l.g) {
        if (m) m.geometry.dispose();
        const g = new THREE.InstancedBufferGeometry();
        g.setIndex(l.g.index);
        for (const [name, attr] of Object.entries(l.g.attributes)) if (!attr.isInstancedBufferAttribute) g.setAttribute(name, attr);
        for (const name of ['iPos', 'iAnim', 'iMisc']) g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
        g.instanceCount = 1;
        g.boundingSphere = l.g.boundingSphere;
        m = this.masks[n] = new THREE.Mesh(g, kd.mask);
        m.frustumCulled = false; m.matrixAutoUpdate = false; m.matrixWorldAutoUpdate = false; m.userData.src = l.g; m.userData.box = new THREE.Box3();
      }
      n++;
      m.material = kd.mask;
      for (const [name, arr] of [['iPos', st.P], ['iAnim', st.An], ['iMisc', st.M]]) {
        const a = m.geometry.attributes[name];
        for (let c = 0; c < 4; c++) a.array[c] = arr[at + c];
        a.needsUpdate = true;
      }
      // (round them: the tallest, broadest body, arms out)
      const x = st.P[at], y = st.P[at + 1], z = st.P[at + 2];
      m.userData.box.min.set(x - 1.3, y - 0.2, z - 1.3); m.userData.box.max.set(x + 1.3, y + 2.5, z + 1.3);
      draw(m, sel, m.userData.box);
    };
    for (const h of this.hl) {
      one(h.kind, h.j, h.at, h.sel);
      for (let p = 0; p < h.parts.length; p += 2) one(h.parts[p], h.j, h.parts[p + 1], h.sel);
    }
  }
  stats() { return this.lodIds.map((_, j) => this.stage.reduce((a, s, k) => a + (isCrowdPart(KINDS[k]) ? 0 : s[j].n), 0)); }
  /** What the crowd draws now (lab checks): how many residents, part models loaded and drawn, and draw calls. */
  crowdStats() {
    let people = 0, parts = 0, drawn = 0, meshes = 0;
    this.kinds.forEach((kd, k) => {
      if (!kd || !isCrowdKind(KINDS[k])) return;
      const n = this.stage[k].reduce((a, s) => a + s.n, 0);
      if (isCrowdPart(KINDS[k])) { parts++; if (n) drawn++; } else people += n;
      meshes += kd.lods.filter(l => l.mesh.visible).length;
    });
    return { on: this.crowdOn, people, parts, drawn, meshes };
  }
}
export { TRIPO_CLIPS };
