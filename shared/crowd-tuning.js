// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The crowd's tuning (2026-11-19, the product owner: "create like a character studio for the animations, skeletal rig and
// clothing so that I can manually make adjustments"): what the owner sets in the Crowd Studio (client/dev/crowd-studio.html)
// and every page draws the crowd with (render/characters.js), kept in the data folder (server/crowd-tuning-routes.js):
// - off: the parts the crowd never wears, by name, per body ('f', 'm') and kind of part;
// - push: a garment (or hair) pushed out along its surface, metres, per body and 'kind/name' (skin or other clothes
//   showing through it); 'kind/*' every part of that kind, added to each one's own;
// - tuck: how far the skin under the clothes worn is pulled in, metres (the same for every body);
// - readyMade: the posture, the clips' own turns and the idles also for the ready-made characters (players', residents'
//   with the classic look), by their body — a man's for the male ones, a woman's for the female (2026-11-20; on unless off);
// - hide: the skin wholly under the clothes worn not drawn at all (as the character builder drops it), only the edge's
//   pulled in (tuck) — so the lighter levels' clothes, simplified on their own, never show it through (2026-11-20);
// - rig: each body's posture, turned at a few joints for every clip it plays (degrees: centre joints [lean forward, turn
//   to its left, tilt to its right], the shoulders and arms [raise, forward, twist], the right side the left's mirror) —
//   applied to the baked animation itself (applyRig), so skin and clothes move as one, as in any pose; clips: more for
//   some clips (render/charClips.js TRIPO_CLIPS names: a seated hunch straightened, 2026-11-19), on top. Builder bodies
//   only: the crowd's, and characters built in the Agent Studio (the same skeleton).
// - bake: how much detail the crowd's library keeps at each level (near, middle, far: render/characters.js's levels of
//   detail; close: a level of its own for the few nearest the camera, downloaded only by the pages that draw it), as the error its shapes may take (metres; null: the library's own budgets) — set in the studio's bake detail,
//   applied by rebuilding the library (server/crowd-bake.js → tools/chars/crowd-pack.mjs --bake);
// - face: the crowd's faces in motion (its heads from the builder: tools/chars/crowd-pack.mjs tags their brows, lips, mouth
//   and eyes) — glances, eyebrow raises, smiles (some residents, and in friendly clips), the mouth moving in the clips
//   that talk, and the blink's pace (every character's).
// Parts are named, not numbered, so a rebuilt library keeps what was set.

export const SEXES = ['f', 'm'];
export const PART_KINDS = ['head', 'hair', 'beard', 'top', 'bottom', 'shoes'];
export const PUSH_MAX = 0.03;
export const TUCK_DEFAULT = 0.014, TUCK_MAX = 0.04;
export const RIG_LIMIT = 30;
/** A single bone's turn (the Crowd Studio's skeleton: any joint, [x, y, z] degrees about the bind pose's axes — x bends
 *  forward/back, y turns, z tilts side to side), at most this far. */
export const BONE_LIMIT = 90;
/** The whole body moved (the skeleton's hips dragged): [x, y, z] metres, at most this far each way. */
export const SHIFT_LIMIT = 0.5;
export function cleanShift(v) {
  if (!Array.isArray(v)) return null;
  const a = [0, 1, 2].map(i => { const x = Number(v[i]); return Number.isFinite(x) ? Math.round(Math.min(SHIFT_LIMIT, Math.max(-SHIFT_LIMIT, x)) * 1000) / 1000 : 0; });
  return a.some(x => x) ? a : null;
}
/** A map of single bones' turns made whole and safe: { [bone name]: [x, y, z] } (null when none). */
export function cleanBones(src) {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return null;
  const out = {};
  for (const [name, v] of Object.entries(src).slice(0, 120)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(name) || !Array.isArray(v)) continue;
    const a = [0, 1, 2].map(i => { const x = Number(v[i]); return Number.isFinite(x) ? +(Math.round(Math.min(BONE_LIMIT, Math.max(-BONE_LIMIT, x)) * 10) / 10).toFixed(1) : 0; });
    if (a.some(x => x)) out[name] = a;
  }
  return Object.keys(out).length ? out : null;
}
/** The joints the studio turns. side: the left's values, mirrored onto the right. */
export const RIG_GROUPS = [
  { id: 'spine', label: 'Lower back', bones: ['Spine'] },
  { id: 'spine1', label: 'Middle back', bones: ['Spine1'] },
  { id: 'chest', label: 'Chest', bones: ['Spine2'] },
  { id: 'neck', label: 'Neck', bones: ['Neck'] },
  { id: 'head', label: 'Head', bones: ['Head'] },
  { id: 'shoulders', label: 'Shoulders (collarbones)', bones: ['LeftShoulder', 'RightShoulder'], side: true },
  { id: 'arms', label: 'Upper arms', bones: ['LeftArm', 'RightArm'], side: true },
];
/** Each group's three values, as the studio's sliders name them (− end, + end). */
export const RIG_AXES = {
  centre: [['Lean back', 'Lean forward'], ['Turn right', 'Turn left'], ['Tilt left', 'Tilt right']],
  side: [['Lower', 'Raise'], ['Back', 'Forward'], ['Twist back', 'Twist forward']],
};
const NAME = 80;
/** The crowd's levels of detail, and how a level's error is reached (the bake and the studio's preview the same way:
 *  tools/chars/crowd-pack.mjs, client/dev/crowd-studio-detail.js): every part to that error in metres, colours and normals
 *  weighed with the shape; under 4 mm its edges keep to the borders, past that small bits go and edges collapse freely. */
export const BAKE_LEVELS = ['close', 'near', 'middle', 'far'];   // (close: a level of its own, only for those nearest the camera — the graphics option Character detail)
export const BAKE_MIN = 0.00005, BAKE_MAX = 0.2;
export const BAKE_WEIGHTS = [0.012, 0.012, 0.012, 0.004, 0.004, 0.004];
export const bakeFlags = err => (err < 0.004 ? ['ErrorAbsolute'] : ['ErrorAbsolute', 'Prune', 'Permissive']);
/** A mesh's simplification attributes: its colour (0–1) and normal, six a vertex (BAKE_WEIGHTS). */
export function bakeAttrs(col, nrm, n) {
  const a = new Float32Array(n * 6);
  for (let v = 0; v < n; v++) { for (let q = 0; q < 3; q++) a[v * 6 + q] = col[v * 4 + q] / 255; for (let q = 0; q < 3; q++) a[v * 6 + 3 + q] = nrm[v * 3 + q]; }
  return a;
}
/** The faces' motion: [default, lowest, highest] — degrees, seconds, metres, shares. */
export const FACE = {
  glance: [12, 0, 25], glanceEvery: [3.5, 1, 15],        // the eyes turning to look about (degrees), how often (seconds)
  brow: [0.0025, 0, 0.007], browEvery: [7, 2, 30],       // the eyebrows raised (metres), how often (seconds)
  smile: [0.0035, 0, 0.007], smileShare: [0.45, 0, 1],    // the mouth's corners up (metres), the share who smile at rest
  talk: [0.004, 0, 0.009], talkRate: [3.2, 1, 7],       // the mouth opening as they talk (metres), syllables a second
  blinkEvery: [4.8, 0, 12],                              // a blink every … seconds (0: never)
};
/** The clips the mouth talks in, and those that smile (render/charClips.js TRIPO_CLIPS names). */
export const TALK_CLIPS = ['agree', 'sit_talk', 'call_stand', 'make_a_call_01', 'greet_02', 'greet_male', 'laugh_01', 'act_sing', 'cheer'];
export const SMILE_CLIPS = ['laugh_01', 'cheer', 'clap', 'clap_02', 'greet_02', 'greet_male', 'wave_goodbye_01', 'wave_stand', 'wave_sit', 'agree', 'sit_talk', 'dance_01', 'dance_02', 'dance_03', 'dance_04', 'dance_05', 'dance_06', 'act_sing', 'act_dj', 'play_arcade'];

const num = (v, lo, hi, d = 0) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
const round = (x, q) => +(Math.round(x / q) * q).toFixed(6);

/** A tuning made whole and safe: unknown keys dropped, numbers clamped, names trimmed. */
export function normalizeTuning(src) {
  const s = src && typeof src === 'object' && !Array.isArray(src) ? src : {};
  const out = { version: 1, off: {}, push: {}, tuck: round(num(s.tuck, 0, TUCK_MAX, TUCK_DEFAULT), 0.0005), hide: s.hide !== false, readyMade: s.readyMade !== false, rig: {}, clips: {}, face: {}, bake: null };
  for (const [k, [d, lo, hi]] of Object.entries(FACE)) out.face[k] = round(num(s.face?.[k], lo, hi, d), hi < 0.05 ? 0.0001 : 0.01);
  if (s.bake && typeof s.bake === 'object') {
    const b = {}; for (const L of BAKE_LEVELS) { const v = s.bake[L]; if (v === null || v === undefined || v === '') continue; const x = Number(v); if (Number.isFinite(x)) b[L] = +Math.min(BAKE_MAX, Math.max(BAKE_MIN, x)).toPrecision(3); }
    if (Object.keys(b).length) out.bake = b;
  }
  for (const sex of SEXES) {
    const off = {}, push = {}, rig = {};
    for (const cat of PART_KINDS) {
      const list = Array.isArray(s.off?.[sex]?.[cat]) ? s.off[sex][cat] : [];
      const names = [...new Set(list.filter(n => typeof n === 'string' && n.trim()).map(n => n.trim().slice(0, NAME)))].slice(0, 200);
      if (names.length) off[cat] = names.sort();
    }
    for (const [key, v] of Object.entries(s.push?.[sex] || {})) {
      const m = /^([a-z]+)\/(.+)$/.exec(key);
      if (!m || !PART_KINDS.includes(m[1])) continue;
      const x = round(num(v, -PUSH_MAX, PUSH_MAX), 0.0005);
      if (x) push[`${m[1]}/${m[2].trim().slice(0, NAME)}`] = x;
    }
    for (const g of RIG_GROUPS) {
      const v = s.rig?.[sex]?.[g.id];
      if (!Array.isArray(v)) continue;
      const a = [0, 1, 2].map(i => round(num(v[i], -RIG_LIMIT, RIG_LIMIT), 0.1));
      if (a.some(x => x)) rig[g.id] = a;
    }
    { const b = cleanBones(s.rig?.[sex]?.bones); if (b) rig.bones = b; }   // (single bones: the studio's skeleton)
    { const m = cleanShift(s.rig?.[sex]?.shift); if (m) rig.shift = m; }   // (the whole body moved: the skeleton's hips)
    if (Object.keys(off).length) out.off[sex] = off;
    if (Object.keys(push).length) out.push[sex] = push;
    if (Object.keys(rig).length) out.rig[sex] = rig;
    const clips = {};
    for (const [name, groups] of Object.entries(s.clips?.[sex] || {}).slice(0, 200)) {
      if (!/^[a-z0-9_]{1,40}$/.test(name) || !groups || typeof groups !== 'object') continue;
      const g2 = {};
      for (const g of RIG_GROUPS) { const v = groups[g.id]; if (!Array.isArray(v)) continue; const a = [0, 1, 2].map(i => round(num(v[i], -RIG_LIMIT, RIG_LIMIT), 0.1)); if (a.some(x => x)) g2[g.id] = a; }
      { const b = cleanBones(groups.bones); if (b) g2.bones = b; }
      { const m = cleanShift(groups.shift); if (m) g2.shift = m; }
      if (Object.keys(g2).length) clips[name] = g2;
    }
    if (Object.keys(clips).length) out.clips[sex] = clips;
  }
  return out;
}

/** Whether part `name` of kind `cat` is worn by the crowd of body `sex`. */
export const partOn = (t, sex, cat, name) => !t?.off?.[sex]?.[cat]?.includes(name);
/** How far part `name` of kind `cat` is pushed out (metres): every part of its kind's, and its own. */
export const pushOf = (t, sex, cat, name) => (t?.push?.[sex]?.[`${cat}/*`] || 0) + (t?.push?.[sex]?.[`${cat}/${name}`] || 0);
/** The parts of each kind the crowd of body `sex` may wear (library indices; every one when all of a kind are off). */
export function allowedParts(t, sex, man) {
  const out = {};
  for (const cat of PART_KINDS) {
    const list = man?.parts?.[cat] || [];
    const on = list.flatMap((p, n) => (partOn(t, sex, cat, p.name) ? [n] : []));
    out[cat] = on.length ? on : list.map((_, n) => n);
  }
  return out;
}
/** Part n of a kind, or the next one the crowd may wear (round the list) when it is off. */
export function nextAllowed(n, allowed, count) {
  if (!allowed || allowed.length >= count || allowed.includes(n)) return n;
  for (let d = 1; d < count; d++) { const k = (n + d) % count; if (allowed.includes(k)) return k; }
  return n;
}

// ------------------------------------------------------------------------------------------------ the rig
/** A Mixamo bone's parent's name (the builder's skeleton; tools/chars/rig.mjs parentName). */
const PARENT_OF = { LeftUpLeg: 'Hips', RightUpLeg: 'Hips', Spine: 'Hips', Spine1: 'Spine', Spine2: 'Spine1', Neck: 'Spine2', Head: 'Neck', HeadTop_End: 'Head', LeftShoulder: 'Spine2', RightShoulder: 'Spine2' };
export function parentName(n) {
  if (n === 'Hips') return null;
  if (PARENT_OF[n]) return PARENT_OF[n];
  const side = n.startsWith('Left') ? 'Left' : n.startsWith('Right') ? 'Right' : null, rest = side ? n.slice(side.length) : n;
  if (!side) return null;
  for (const s of [['UpLeg', 'Leg', 'Foot', 'ToeBase', 'Toe_End'], ['Shoulder', 'Arm', 'ForeArm', 'Hand']]) { const i = s.indexOf(rest); if (i > 0) return side + s[i - 1]; }
  const m = /^Hand(Index|Middle|Pinky|Ring|Thumb)(\d)$/.exec(rest);
  if (m) return m[2] === '1' ? side + 'Hand' : `${side}Hand${m[1]}${m[2] - 1}`;
  return null;
}

/** A rotation (row-major 3×3) of [x, y, z] degrees about the bind pose's axes (x the body's left, y up, z forward),
 *  turned about x, then y, then z. */
function rot([ax, ay, az]) {
  const r = Math.PI / 180, [cx, sx, cy, sy, cz, sz] = [Math.cos(ax * r), Math.sin(ax * r), Math.cos(ay * r), Math.sin(ay * r), Math.cos(az * r), Math.sin(az * r)];
  const X = [1, 0, 0, 0, cx, -sx, 0, sx, cx], Y = [cy, 0, sy, 0, 1, 0, -sy, 0, cy], Z = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul3(Z, mul3(Y, X));
}
function mul3(a, b) { const o = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return o; }
/** A group's values → each of its bones' rotation [x, y, z] degrees (the left's; the right mirrored: y and z turn back). */
export function groupAngles(g, v) {
  const [a, b, c] = v;
  if (!g.side) return g.bones.map(() => [a, b, c]);   // [lean, turn, tilt] → about x, y, z
  const left = [c, -b, a];                            // [raise, forward, twist] → twist about x, forward about −y, raise about z
  return [left, [left[0], -left[1], -left[2]]];
}

// half floats (the animation's texels)
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
let HALF = null;
function fromHalfTable() {
  const t = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
    t[h] = e === 0 ? s * f * 2 ** -24 : e === 31 ? (f ? NaN : s * Infinity) : s * (1 + f / 1024) * 2 ** (e - 15);
  }
  return t;
}
export function toHalf(x) {
  F32[0] = x; const b = U32[0], s = (b >>> 16) & 0x8000, e = ((b >>> 23) & 255) - 127 + 15;
  let m = b & 0x7fffff;
  if (e >= 31) return s | 0x7c00;
  if (e <= 0) { if (e < -10) return s; m |= 0x800000; const sh = 14 - e; let h = m >> sh; if ((m >> (sh - 1)) & 1) h++; return s | h; }
  let h = s | (e << 10) | (m >> 13);
  if (m & 0x1000) h++;   // (round half up: as close as three's DataUtils)
  return h;
}

/**
 * The clips whose standing still stepped (2026-11-20, the product owner: the idle "has them like sliding on the ground on
 * the same spot … they step to the side … all while sliding"): its feet moved ~18 cm, side steps the animation then slid
 * back. Planted (plantClips): the legs and hips held as at the clip's first frame, everything above them carried with the
 * hips' own motion taken off — the body's sway, breathing and looks about kept, the feet where they stand.
 */
export const PLANT_CLIPS = ['idle', 'hold_idle', 'hold_phone', 'hold_drink'];
/** Each body's idles, each resident one of them (render/characters.js idleFor; the same product owner's picks, 2026-11-20):
 *  a woman the planted idle, the relaxed wait or hands on hips; a man the relaxed wait or hands on hips. */
export const IDLES = { f: ['idle', 'wait_02', 'wait'], m: ['wait_02', 'wait'] };
/**
 * Clips made for another body's proportions, set right for the builder's (2026-11-20, the product owner: hands on hips
 * "way too exaggerating … the mid section of the body … way too flexed, also their hand is floating where the hip will
 * be"): per body, turns as the Crowd Studio's per-clip posture (RIG_GROUPS values), added under the owner's own for that
 * clip (withClipFix). wait (hands on hips): the waist's side bend 23° → ~8°, the palms onto the hips (4.7 / 9.2 cm off
 * → ~3 cm, the palm's middle: on them) — fitted against each body's mesh over the clip.
 */
export const CLIP_FIX = { f: {}, m: {} };   // (2026-11-20: a fitted fix for wait looked worse — the owner sets it in the Crowd Studio's skeleton)
/** The owner's per-clip turns (a body's: { [clip]: { [group]: [3] } }) with CLIP_FIX's added under them. */
export function withClipFix(sex, clips) {
  const fix = CLIP_FIX[sex] || {}, out = {};
  for (const name of new Set([...Object.keys(fix), ...Object.keys(clips || {})])) {
    const a = fix[name] || {}, b = clips?.[name] || {}, g = {};
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (id === 'bones') { const m = {}; for (const n of new Set([...Object.keys(a.bones || {}), ...Object.keys(b.bones || {})])) m[n] = [0, 1, 2].map(i => (a.bones?.[n]?.[i] || 0) + (b.bones?.[n]?.[i] || 0)); g.bones = m; continue; }
      g[id] = [0, 1, 2].map(i => (a[id]?.[i] || 0) + (b[id]?.[i] || 0));
    }
    out[name] = g;
  }
  return out;
}
/** Plants clips `names` of a baked animation in place (anim as applyRig's; a skeleton with Hips and legs named as the
 *  builder's). → how many clips. */
export function plantClips(anim, names = PLANT_CLIPS) {
  const { data, bones } = anim, short = (anim.names || []).map(n => String(n).replace(/^mixamorig:/, ''));
  const hip = short.indexOf('Hips');
  if (hip < 0 || !data) return 0;
  HALF ??= fromHalfTable();
  const leg = short.map((n, b) => b === hip || /(UpLeg|Leg|Foot|Toe)/.test(n));
  const S = new Float64Array(12), T = new Float64Array(12);
  const inv = m => {   // (an affine 3×4's inverse)
    const L = inv3([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]); if (!L) return null;
    const R = new Float64Array(12);
    for (let r = 0; r < 3; r++) { R[r * 4] = L[r * 3]; R[r * 4 + 1] = L[r * 3 + 1]; R[r * 4 + 2] = L[r * 3 + 2]; R[r * 4 + 3] = -(L[r * 3] * m[3] + L[r * 3 + 1] * m[7] + L[r * 3 + 2] * m[11]); }
    return R;
  };
  const mul = (a, b, out) => { for (let r = 0; r < 3; r++) { for (let c = 0; c < 3; c++) out[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c]; out[r * 4 + 3] = a[r * 4] * b[3] + a[r * 4 + 1] * b[7] + a[r * 4 + 2] * b[11] + a[r * 4 + 3]; } return out; };
  let n = 0;
  for (const name of names) {
    const c = (anim.clips || []).find(x => x.name === name);
    if (!c) continue;
    const f0 = Math.round(c.off), len = Math.abs(Math.round(c.len)), first = new Float64Array(bones * 12);
    for (let i = 0; i < bones * 12; i++) first[i] = HALF[data[f0 * bones * 12 + i]];
    const H0 = first.subarray(hip * 12, hip * 12 + 12);
    for (let f = f0 + 1; f < f0 + len; f++) {
      const o = f * bones * 12;
      for (let i = 0; i < 12; i++) S[i] = HALF[data[o + hip * 12 + i]];
      const Hi = inv(S); if (!Hi) continue;
      const R = mul(H0, Hi, new Float64Array(12));   // (the hips back to where they stood: carried onto all above them)
      for (let b = 0; b < bones; b++) {
        const q = o + b * 12;
        if (leg[b]) { for (let i = 0; i < 12; i++) data[q + i] = toHalf(first[b * 12 + i]); continue; }
        for (let i = 0; i < 12; i++) S[i] = HALF[data[q + i]];
        mul(R, S, T);
        for (let i = 0; i < 12; i++) data[q + i] = toHalf(T[i]);
      }
    }
    n++;
  }
  return n;
}

/**
 * Turns the body's joints in every frame of a baked animation (render/characters.js: half floats, 3 texels a bone, the
 * skinning matrix's rows), in place. anim: { data: Uint16Array, frames, bones, names, clips?: [{ name, off, len }] };
 * rig: a body's groups ({ [group id]: [3 values] }), every clip; byClip: more for some clips ({ [clip name]: groups }),
 * turned after the body's own, in that clip's frames only. Each joint turns about its own point (found from the frames:
 * where it and its parent always meet), in the bind pose's axes, carrying everything below it. → how many joints turned
 * (the body's own, and each clip's).
 */
export function applyRig(anim, rig, byClip = null) {
  const { data, frames, bones, names } = anim;
  const short = names.map(n => String(n).replace(/^mixamorig:/, ''));
  const parent = short.map(n => short.indexOf(parentName(n) ?? ''));
  const kids = short.map(() => []); parent.forEach((p, j) => { if (p >= 0) kids[p].push(j); });
  const under = j => { const out = [j]; for (let k = 0; k < out.length; k++) out.push(...kids[out[k]]); return out; };
  const pivots = new Map(), pointOf = j => {
    if (!pivots.has(j)) { const p = pivot(data, frames, bones, j, parent[j]); pivots.set(j, p.every(Number.isFinite) && Math.hypot(...p) <= 4 ? p : null); }
    return pivots.get(j);   // (a joint whose point the frames cannot tell — it never turns against its parent — stays)
  };
  // (the hips have no parent to meet: their point, the middle of the two hip joints)
  const hipPoint = j => { const l = short.indexOf('LeftUpLeg'), r = short.indexOf('RightUpLeg'), a = l >= 0 ? pointOf(l) : null, b = r >= 0 ? pointOf(r) : null; return a && b ? [0, 1, 2].map(i => (a[i] + b[i]) / 2) : null; };
  const turnsOf = groups => {
    const out = [];
    for (const g of RIG_GROUPS) {
      const v = groups?.[g.id]; if (!v || !v.some(x => x)) continue;
      groupAngles(g, v).forEach((a, i) => { const j = short.indexOf(g.bones[i]); const p = j >= 0 ? pointOf(j) : null; if (p) out.push({ j, R: rot(a), p, under: under(j) }); });
    }
    // single bones (the studio's skeleton): each about its own joint, in the bind pose's axes, carrying what hangs from it
    for (const [name, v] of Object.entries(groups?.bones || {})) {
      const j = short.indexOf(name); if (j < 0 || !Array.isArray(v) || !v.some(x => x)) continue;
      const p = parent[j] < 0 ? hipPoint(j) : pointOf(j);
      if (p) out.push({ j, R: rot(v), p, under: under(j) });
    }
    return out.sort((a, b) => a.j - b.j);   // (the bones come parents first)
  };
  const base = turnsOf(rig);
  // (the whole body moved, metres: the body's own, and its clip's added)
  const shiftOf = g => (Array.isArray(g?.shift) && g.shift.some(x => x) ? g.shift.map(Number) : null);
  const baseShift = shiftOf(rig);
  // each frame's turns: the body's own, then its clip's (a stable sort keeps the body's first at the same joint)
  const lists = [base], shifts = [baseShift], at = new Int32Array(frames);
  for (const c of anim.clips || []) {
    const extra = byClip?.[c.name] ? turnsOf(byClip[c.name]) : [], cs = shiftOf(byClip?.[c.name]);
    if (!extra.length && !cs) continue;
    lists.push([...base, ...extra].sort((a, b) => a.j - b.j));
    shifts.push(cs ? [0, 1, 2].map(i => cs[i] + (baseShift?.[i] || 0)) : baseShift);
    for (let f = Math.max(0, c.off); f < Math.min(frames, c.off + c.len); f++) at[f] = lists.length - 1;
  }
  if (lists.every(l => !l.length) && shifts.every(x => !x)) return 0;
  HALF ??= fromHalfTable();
  const M = new Float64Array(bones * 12), changed = new Uint8Array(bones);
  for (const l of lists) for (const t of l) for (const d of t.under) changed[d] = 1;
  const C = new Float64Array(12), S = new Float64Array(12);
  for (let f = 0; f < frames; f++) {
    const turns = lists[at[f]], sh = shifts[at[f]];
    if (!turns.length && !sh) continue;
    const o0 = f * bones * 12;
    for (let i = 0; i < bones * 12; i++) M[i] = HALF[data[o0 + i]];
    for (const t of turns) {
      // C = S_j · [R | p − R p] · S_j⁻¹, then every bone under it: S_d ← C · S_d
      const o = t.j * 12, R = t.R, p = t.p;
      const tx = p[0] - (R[0] * p[0] + R[1] * p[1] + R[2] * p[2]), ty = p[1] - (R[3] * p[0] + R[4] * p[1] + R[5] * p[2]), tz = p[2] - (R[6] * p[0] + R[7] * p[1] + R[8] * p[2]);
      for (let i = 0; i < 12; i++) S[i] = M[o + i];
      const A = [S[0], S[1], S[2], S[4], S[5], S[6], S[8], S[9], S[10]], AR = mul3(A, R), inv = inv3(A);
      if (!inv) continue;
      const B = mul3(AR, inv);                                    // the linear part: A R A⁻¹
      const ti = [S[3], S[7], S[11]], ax = [A[0] * tx + A[1] * ty + A[2] * tz, A[3] * tx + A[4] * ty + A[5] * tz, A[6] * tx + A[7] * ty + A[8] * tz];
      // translation: A t' + s − B s  (S = [A | s])
      for (let r = 0; r < 3; r++) {
        C[r * 4] = B[r * 3]; C[r * 4 + 1] = B[r * 3 + 1]; C[r * 4 + 2] = B[r * 3 + 2];
        C[r * 4 + 3] = ax[r] + ti[r] - (B[r * 3] * ti[0] + B[r * 3 + 1] * ti[1] + B[r * 3 + 2] * ti[2]);
      }
      for (const d of t.under) {
        const q = d * 12;
        for (let i = 0; i < 12; i++) S[i] = M[q + i];
        for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++)
          M[q + r * 4 + c] = C[r * 4] * S[c] + C[r * 4 + 1] * S[4 + c] + C[r * 4 + 2] * S[8 + c] + (c === 3 ? C[r * 4 + 3] : 0);
      }
    }
    if (sh) { for (let b = 0; b < bones; b++) { M[b * 12 + 3] += sh[0]; M[b * 12 + 7] += sh[1]; M[b * 12 + 11] += sh[2]; } for (let i = 0; i < bones * 12; i++) data[o0 + i] = toHalf(M[i]); continue; }
    for (let b = 0; b < bones; b++) if (changed[b]) for (let i = 0; i < 12; i++) data[o0 + b * 12 + i] = toHalf(M[b * 12 + i]);
  }
  return lists.reduce((n, l) => n + l.length, 0) - (lists.length - 1) * base.length;
}
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), Cc = d * h - e * g, det = a * A + b * B + c * Cc;
  if (Math.abs(det) < 1e-12) return null;
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, Cc * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}
/** Where joint j is in the bind pose: the point its bone and its parent's carry to the same place in every frame
 *  (least squares over the frames: (A_p − A_j) x = s_j − s_p). */
export function pivot(data, frames, bones, j, p) {
  HALF ??= fromHalfTable();
  if (p < 0) return [0, 0, 0];
  const N = new Float64Array(9), r = new Float64Array(3), step = Math.max(1, Math.floor(frames / 800));
  for (let f = 0; f < frames; f += step) {
    const oj = (f * bones + j) * 12, op = (f * bones + p) * 12;
    for (let row = 0; row < 3; row++) {
      const a = [0, 1, 2].map(c => HALF[data[op + row * 4 + c]] - HALF[data[oj + row * 4 + c]]), b = HALF[data[oj + row * 4 + 3]] - HALF[data[op + row * 4 + 3]];
      for (let x = 0; x < 3; x++) { r[x] += a[x] * b; for (let y = 0; y < 3; y++) N[x * 3 + y] += a[x] * a[y]; }
    }
  }
  for (let x = 0; x < 3; x++) N[x * 4] += 1e-9;
  const I = inv3([...N]);
  return I ? [0, 1, 2].map(x => I[x * 3] * r[0] + I[x * 3 + 1] * r[1] + I[x * 3 + 2] * r[2]) : [0, 0, 0];
}
