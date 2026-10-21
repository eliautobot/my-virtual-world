// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The baked characters' skeletons, recovered from their clips, and posing by aiming bones — shared by the tools that add
// clips to the characters (tools/chars/extra-clips.mjs) and those that measure them.
//
// A character's bake (client/assets/chars/<kind>.bin) carries no rest skeleton, only per-frame skinning matrices (bind
// space → posed, 3 rows of RGBA half floats per bone per frame). Each joint is recovered from them where a bone and its
// parent agree in every frame (least squares; residual well under a millimetre). Posing aims bones along directions in the
// body's own frame (x its left, y up, z forward) from a base frame, which gives the same result on the A-posed and the
// T-posed rigs; a hand can also be turned about its length so its palm faces a given way, and the fingers lie flat (a
// paddle) or close round a grip.
import fs from 'node:fs';
import path from 'node:path';

export const TAU = Math.PI * 2, PI = Math.PI;

// ------------------------------------------------------------------ half floats
export const f2h = (() => {
  const fb = new Float32Array(1), ib = new Uint32Array(fb.buffer);
  return v => {
    fb[0] = v; const x = ib[0], s = (x >>> 16) & 0x8000; let e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
    if (e <= 0) { if (e < -10) return s; m = (m | 0x800000) >> (1 - e); return s | ((m + 0x1000) >> 13); }
    if (e >= 31) return s | 0x7c00;
    // rounding may carry into the exponent: added, not or-ed — or-ing it halved such a value whenever the exponent was odd
    // (a hand's matrix entry of 0.49997 came out 0.25: a bent wrist in one frame, 2026-10-07)
    return s | ((e << 10) + ((m + 0x1000) >> 13));
  };
})();
export const h2f = h => { const s = h >> 15, e = (h >> 10) & 31, f = h & 1023; return (s ? -1 : 1) * (e === 0 ? f / 1024 * 2 ** -14 : e === 31 ? NaN : (1 + f / 1024) * 2 ** (e - 15)); };

// ------------------------------------------------------------------ 3×4 transforms [r00 r01 r02 tx, r10 … , r20 …]
export const mul = (A, B) => { const C = new Array(12); for (let r = 0; r < 3; r++) { for (let c = 0; c < 3; c++) C[r * 4 + c] = A[r * 4] * B[c] + A[r * 4 + 1] * B[4 + c] + A[r * 4 + 2] * B[8 + c]; C[r * 4 + 3] = A[r * 4] * B[3] + A[r * 4 + 1] * B[7] + A[r * 4 + 2] * B[11] + A[r * 4 + 3]; } return C; };
export const app = (A, p) => [0, 1, 2].map(r => A[r * 4] * p[0] + A[r * 4 + 1] * p[1] + A[r * 4 + 2] * p[2] + A[r * 4 + 3]);
export const rotv = (A, v) => [0, 1, 2].map(r => A[r * 4] * v[0] + A[r * 4 + 1] * v[1] + A[r * 4 + 2] * v[2]);
export const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const nrm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Rotation by angle t about unit axis k, as a 3×4 about point p. */
export function rotAbout(k, t, p) {
  const c = Math.cos(t), s = Math.sin(t), C = 1 - c, [x, y, z] = k;
  const R = [c + x * x * C, x * y * C - z * s, x * z * C + y * s, 0, y * x * C + z * s, c + y * y * C, y * z * C - x * s, 0, z * x * C - y * s, z * y * C + x * s, c + z * z * C, 0];
  const q = rotv(R, p); R[3] = p[0] - q[0]; R[7] = p[1] - q[1]; R[11] = p[2] - q[2];
  return R;
}
/** The shortest rotation taking direction a to direction b, about point p. */
export function aim(a, b, p) {
  a = nrm(a); b = nrm(b);
  const d = Math.max(-1, Math.min(1, dot(a, b)));
  if (d > 0.99999) return I;
  let k = cross(a, b); if (len(k) < 1e-6) k = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]);
  return rotAbout(nrm(k), Math.acos(d), p);
}
/** Inverse of a rigid 3×4 (rotation + translation). */
export function inv(A) {
  const R = [A[0], A[4], A[8], 0, A[1], A[5], A[9], 0, A[2], A[6], A[10], 0];
  const t = rotv(R, [A[3], A[7], A[11]]); R[3] = -t[0]; R[7] = -t[1]; R[11] = -t[2];
  return R;
}

// ------------------------------------------------------------------ directions
export const V = (x, y, z) => nrm([x, y, z]);
/** The same direction for the other side of the body. */
export const mir = d => [-d[0], d[1], d[2]];
export const lerpDir = (a, b, t) => nrm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
export const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** Key directions [[u, dir], …] (cyclic) at phase u. */
export function keyed(keys, u) {
  for (let k = 0; k < keys.length; k++) {
    const [u0, a] = keys[k], [u1r, b] = keys[(k + 1) % keys.length], u1 = k + 1 < keys.length ? u1r : u1r + 1;
    const uu = u < u0 ? u + 1 : u;
    if (uu >= u0 && uu < u1) return lerpDir(a, b, smooth((uu - u0) / (u1 - u0)));
  }
  return keys[0][1];
}

// ------------------------------------------------------------------ the skeleton
const PARENT_OF = { LeftUpLeg: 'Hips', RightUpLeg: 'Hips', Spine: 'Hips', Spine1: 'Spine', Spine2: 'Spine1', Neck: 'Spine2', Head: 'Neck', HeadTop_End: 'Head', LeftShoulder: 'Spine2', RightShoulder: 'Spine2' };
export function parentName(n) {
  if (n === 'Hips') return null;
  if (PARENT_OF[n]) return PARENT_OF[n];
  const side = n.startsWith('Left') ? 'Left' : 'Right', rest = n.slice(side.length);
  for (const s of [['UpLeg', 'Leg', 'Foot', 'ToeBase', 'Toe_End'], ['Shoulder', 'Arm', 'ForeArm', 'Hand']]) { const i = s.indexOf(rest); if (i > 0) return side + s[i - 1]; }
  const m = /^Hand(Index|Middle|Pinky|Ring|Thumb)(\d)$/.exec(rest);
  if (m) return m[2] === '1' ? side + 'Hand' : `${side}Hand${m[1]}${m[2] - 1}`;
  throw new Error('no parent for ' + n);
}
/** Bones that are aimed, and the joint each aims at. */
export const AIM = { Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head', Head: 'HeadTop_End' };
for (const s of ['Left', 'Right']) Object.assign(AIM, { [s + 'Arm']: s + 'ForeArm', [s + 'ForeArm']: s + 'Hand', [s + 'Hand']: s + 'HandMiddle1', [s + 'UpLeg']: s + 'Leg', [s + 'Leg']: s + 'Foot', [s + 'Foot']: s + 'ToeBase' });
/** The fingers' joints, each aimed at the next. */
export const FINGER = /^(Left|Right)Hand(Index|Middle|Ring|Pinky|Thumb)([123])$/;

/**
 * One character's bake and skeleton: { kind, man, NB, M(frame, bone) → 3×4 skinning, N (bone names without the
 * mixamorig: prefix), idx (name → bone), P (parents), J (joints, bind space), rms (joint residual, metres), order
 * (parents before children), clip(name) }.
 */
export function loadRig(dir, kind) {
  const man = JSON.parse(fs.readFileSync(path.join(dir, kind + '.json'), 'utf8'));
  if (!man.anim || !man.names) return null;
  const bin = fs.readFileSync(path.join(dir, kind + '.bin')), a = man.anim, NB = man.bones;
  const u16 = new Uint16Array(bin.buffer.slice(bin.byteOffset + a.data.off, bin.byteOffset + a.data.off + a.data.len));
  const M = (fr, b) => { const i = (fr * NB + b) * 12, r = new Array(12); for (let q = 0; q < 12; q++) r[q] = h2f(u16[i + q]); return r; };
  M.NB = NB;
  const N = man.names.map(n => n.replace(/^mixamorig:/, '')), idx = Object.fromEntries(N.map((n, i) => [n, i]));
  const P = N.map(n => { const p = parentName(n); return p === null ? -1 : idx[p]; });
  const J = N.map(() => null), res = [];
  for (let c = 0; c < NB; c++) {
    if (P[c] < 0) continue;
    const p = P[c], A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bv = [0, 0, 0];
    for (let f = 0; f < a.frames; f += 2) {
      const mc = M(f, c), mp = M(f, p);
      for (let r = 0; r < 3; r++) {
        const row = [mc[r * 4] - mp[r * 4], mc[r * 4 + 1] - mp[r * 4 + 1], mc[r * 4 + 2] - mp[r * 4 + 2]], b = mp[r * 4 + 3] - mc[r * 4 + 3];
        for (let x = 0; x < 3; x++) { bv[x] += row[x] * b; for (let y = 0; y < 3; y++) A[x][y] += row[x] * row[y]; }
      }
    }
    for (let x = 0; x < 3; x++) A[x][x] += 1e-7;
    const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(A);
    J[c] = [0, 1, 2].map(i => det(A.map((row, r) => row.map((v, k) => (k === i ? bv[r] : v)))) / D);
    if (N[c] === 'HeadTop_End') continue;
    const mc = M(0, c), mp = M(0, p); res.push(len(sub(app(mc, J[c]), app(mp, J[c]))));
  }
  const hips = idx.Hips;
  J[hips] = [(J[idx.LeftUpLeg][0] + J[idx.RightUpLeg][0]) / 2, (J[idx.LeftUpLeg][1] + J[idx.RightUpLeg][1] + J[idx.Spine][1]) / 3, (J[idx.LeftUpLeg][2] + J[idx.RightUpLeg][2]) / 2];
  // HeadTop_End never moves against the head, so the bake can't place it (it came out anywhere — the swimming heads were
  // twisted out of shape, 2026-10-05): put it on the neck's line, 0.2 m above the head's joint, as it stands in any rig
  { const hn = nrm(sub(J[idx.Head], J[idx.Neck])); J[idx.HeadTop_End] = [J[idx.Head][0] + hn[0] * 0.2, J[idx.Head][1] + hn[1] * 0.2, J[idx.Head][2] + hn[2] * 0.2]; }
  // the same for each finger's end (…Index4, …Thumb4: never moves against the knuckle before it): it came out 0.75–1.6 m
  // away, on some bodies behind the hand, and the last knuckle of every finger posed to hold something was aimed at it —
  // the fingertips bent backward (2026-10-07, drinking). Put it on the line of the bone before, 0.8 of its length on.
  for (const n of N) {
    const m = /^(Left|Right)Hand(Index|Middle|Ring|Pinky|Thumb)4$/.exec(n);
    if (!m) continue;
    const j3 = J[idx[`${m[1]}Hand${m[2]}3`]], j2 = J[idx[`${m[1]}Hand${m[2]}2`]];
    J[idx[n]] = add(j3, scale(sub(j3, j2), 0.8));
  }
  const rms = Math.sqrt(res.reduce((s, x) => s + x * x, 0) / res.length);
  const order = [], seen = new Set(), visit = b => { if (seen.has(b)) return; if (P[b] >= 0) visit(P[b]); seen.add(b); order.push(b); };
  for (let b = 0; b < NB; b++) visit(b);
  const clip = name => man.clips.find(c => c.name === name) || null;
  return { kind, man, NB, M, N, idx, P, J, rms, order, clip };
}

/** A frame's skinning matrices (an array of NB 3×4) from the bake. */
export const frameOf = (R, fr) => Array.from({ length: R.NB }, (_, b) => R.M(fr, b));
/** Where each joint stands in a frame's skinning. */
export const jointsOf = (R, F) => R.J.map((j, b) => (j ? app(F[b], j) : null));

/**
 * The palm's normal of each hand in a frame (body frame as posed), from its joints: wrist to middle finger along, pinky
 * to index across; for a left hand palm = along × across, mirrored for the right.
 */
export function palmsOf(R, X) {
  const out = {};
  for (const [side, sg] of [['Left', 1], ['Right', -1]]) {
    const along = sub(X[R.idx[side + 'HandMiddle1']], X[R.idx[side + 'Hand']]), across = sub(X[R.idx[side + 'HandIndex1']], X[R.idx[side + 'HandPinky1']]);
    out[side] = nrm(cross(along, across).map(v => v * sg));
  }
  return out;
}

/**
 * Poses a character from a base frame F0 (its skinning matrices). pose = { d: { BoneName: direction, …, palm: { Left,
 * Right } }, root (3×4 applied to the whole body, default none), hands: { Left|Right: 'flat' | 'grip' | number (grip
 * closure 0..1) } }. Directions are in the body's frame and are turned by root. Bones not named keep their place relative
 * to their parent (so a base frame's walk goes on where nothing is aimed). Returns NB skinning matrices.
 */
export function poseFrom(R, F0, pose) {
  const { N, idx, P, NB, order } = R, X0 = jointsOf(R, F0), palm0 = palmsOf(R, X0), root = pose.root || I;
  const D = new Array(NB);
  for (const b of order) {
    const p = P[b], Dp = p < 0 ? root : D[p], n = N[b];
    const fm = FINGER.exec(n);
    if (fm && pose.hands?.[fm[1]] !== undefined) {
      const [, side, fg, seg] = fm, h = idx[side + 'Hand'], Dh = D[h], next = idx[`${side}Hand${fg}${+seg + 1}`];
      if (next === undefined) { D[b] = Dp; continue; }
      const along = nrm(rotv(Dh, sub(X0[idx[side + 'HandMiddle1']], X0[h]))), palm = nrm(rotv(Dh, palm0[side]));
      const radial = nrm(rotv(Dh, sub(X0[idx[side + 'HandIndex1']], X0[idx[side + 'HandPinky1']])));
      const mode = pose.hands[side];
      let want;
      if (mode === 'flat') want = fg === 'Thumb' ? nrm(along.map((v, i) => v + 0.55 * radial[i] + 0.2 * palm[i])) : nrm(along.map((v, i) => v + 0.1 * +seg * palm[i]));
      else {
        // a grip: each joint bends toward the palm (the fingers close round a cup or a phone's edge); the thumb comes
        // across the palm's side, opposite the fingers. Open (a phone, a book) it stands off the index finger's side; closed
        // round something (a cup, a burger, a knife's handle) it wraps the far face of it, toward the fingertips — not up
        // along it (2026-10-07: the thumb stood up like a thumbs-up on every cup)
        const k = mode === 'grip' ? 1 : +mode;
        if (fg === 'Thumb') {
          const w = smooth((k - 0.35) / 0.6), s2 = +seg >= 2;
          const open = [0.55, 0.66, s2 ? 0.66 : 0.51], wrap = seg === '1' ? [0.45, 0.25, 0.85] : seg === '2' ? [0.85, 0.1, 0.5] : [1, -0.15, 0.08];
          const c = open.map((v, i) => v + (wrap[i] - v) * w);
          want = nrm(along.map((v, i) => c[0] * v + c[1] * radial[i] + c[2] * palm[i]));
        }
        else {
          const ang = k * [0.75, 1.55, 2.2][+seg - 1];   // the angle each segment points at, from along the hand toward the palm
          want = nrm(along.map((v, i) => Math.cos(ang) * v + Math.sin(ang) * palm[i]));
        }
      }
      const piv = app(Dp, X0[b]), cur = rotv(Dp, sub(X0[next], X0[b]));
      D[b] = mul(aim(cur, want, piv), Dp);
      continue;
    }
    const tgt = pose.d[n] && AIM[n] ? pose.d[n] : null;
    if (!tgt) { D[b] = Dp; continue; }
    const piv = app(Dp, X0[b]), cur = rotv(Dp, sub(X0[idx[AIM[n]]], X0[b])), want = rotv(root, tgt);
    D[b] = mul(aim(cur, want, piv), Dp);
    // the palm: the forearm turns half of the way about its length, the hand the rest
    const side = n.startsWith('Left') ? 'Left' : 'Right', pt = pose.d.palm?.[side], part = n === side + 'ForeArm' ? 0.5 : n === side + 'Hand' ? 1 : 0;
    if (pt && part && !pose.noTwist) {
      const axis = nrm(rotv(D[b], sub(X0[idx[AIM[n]]], X0[b]))), now = rotv(D[b], palm0[side]), goal = rotv(root, pt);
      const along = v => sub(v, axis.map(a => a * dot(v, axis))), a = along(now), g = along(goal);
      if (len(a) > 1e-4 && len(g) > 1e-4) D[b] = mul(rotAbout(axis, Math.atan2(dot(axis, cross(a, g)), dot(a, g)) * part, piv), D[b]);
    }
  }
  return D.map((d, b) => mul(d, F0[b]));
}

/** Reads the characters' list (client/assets/chars/index.js TEXTURED). */
export function kindsIn(dir) {
  const index = fs.readFileSync(path.join(dir, 'index.js'), 'utf8');
  return JSON.parse(/TEXTURED = (\[[^\]]*\])/.exec(index)[1].replace(/'/g, '"'));
}
