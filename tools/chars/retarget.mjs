// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The bake's clips moved onto another skeleton of the same 65-bone rig (a character from the builder, client/js/builder/):
// world-space rotation deltas, as the original bake moved the male clips onto the female rig.
//
// A baked character's skinning matrix for bone b in frame f is S = [R | t]: bind space → posed. R is how the bone turned
// from its bind pose, in the body's own frame (x its left, y up, z forward). A body built on the same A-posed Tripo base
// stands in nearly the same bind pose, so each of its bones turns by the same R — after a small alignment C (the
// rotation taking the new bone's bind direction onto the reference's, with a second axis for its twist: the hands by
// their knuckles, the rest by the body's left). Joints are placed down the hierarchy from the new bind skeleton (child =
// parent's posed joint + parent's R'·bind offset), so every bone keeps its own length; the hips move as the reference's
// did, scaled by the ratio of the two bodies' hip heights (in-place clips: sway and bob, the drop onto a seat).
// The trunk (spine, neck, head, collarbones: opts.delta) is not aligned but turned by the reference's own turn from its
// bind pose (2026-11-19, the product owner: the builder's men "a bit too hunched", "looking up slightly", their clothes
// cut through at the upper back and collar): aligning a neck that leans 4° more than the reference's tipped the head
// back by those 4° standing still, and bent the trunk away from the pose the clothes were fitted in. Its own posture kept,
// its motion the reference's; the limbs still aligned (hands, feet and seats where the reference's are).
import { mul, app, rotv, sub, add, scale, len, nrm, cross, dot, I, AIM, FINGER } from './rig.mjs';

/** Rows of a 3×3 from three column vectors. */
const cols = (a, b, c) => [a[0], b[0], c[0], 0, a[1], b[1], c[1], 0, a[2], b[2], c[2], 0];
const T3 = A => [A[0], A[4], A[8], 0, A[1], A[5], A[9], 0, A[2], A[6], A[10], 0];
/** An orthonormal frame [primary, secondary ⊥, third] as a rotation's columns, or null when the two are parallel. */
function frame(a, s) {
  a = nrm(a);
  let t = sub(s, scale(a, dot(s, a)));
  if (len(t) < 1e-5) return null;
  t = nrm(t);
  return cols(a, t, cross(a, t));
}
/** The rotation part of a skinning matrix made exactly orthonormal (half floats leave it a little off). */
export function orthonormal(M) {
  const x = nrm([M[0], M[4], M[8]]);
  let y = [M[1], M[5], M[9]];
  y = nrm(sub(y, scale(x, dot(x, y))));
  const z = cross(x, y);
  return cols(x, y, z);
}

/** For bone n: the joint its primary axis points at, from J (joint positions by name). Leaves follow their parent. */
function axisOf(n, J, P) {
  // the head's top and the fingers' ends are placed by rule in the bake (rig.mjs loadRig), not measured: the head and the
  // last knuckles aim along the bone before them instead, the same in both skeletons
  if (n === 'Head') return sub(J.Head, J.Neck);
  const fm = FINGER.exec(n);
  if (fm) {
    const [, side, fg, seg] = fm;
    if (seg === '3') return sub(J[`${side}Hand${fg}3`], J[`${side}Hand${fg}2`]);
    return sub(J[`${side}Hand${fg}${+seg + 1}`], J[n]);
  }
  if (/ToeBase$/.test(n)) return sub(J[n], J[n.replace('ToeBase', 'Foot')]);
  if (/Shoulder$/.test(n)) return sub(J[n.replace('Shoulder', 'Arm')], J[n]);
  if (AIM[n]) return sub(J[AIM[n]], J[n]);
  return null;
}
/** The second axis that fixes a bone's twist: a hand's (and its fingers') knuckle line, else the body's left. */
function twistOf(n, J) {
  const side = n.startsWith('Left') ? 'Left' : n.startsWith('Right') ? 'Right' : null;
  if (side && /Hand/.test(n)) return sub(J[side + 'HandIndex1'], J[side + 'HandPinky1']);
  if (/Shoulder$/.test(n)) return [0, 0, 1];   // (the collarbone lies along x: its twist by forward)
  return [1, 0, 0];
}

/**
 * The alignment of each bone: C[b] takes the new skeleton's bind frame of bone b onto the reference's. src/dst: { N
 * (names), J (joints, bind) }. Leaves and the hips take their parent's (the hips: none).
 */
export function alignments(src, dst, P) {
  const Js = Object.fromEntries(src.N.map((n, i) => [n, src.J[i]])), Jd = Object.fromEntries(dst.N.map((n, i) => [n, dst.J[i]]));
  const C = new Array(src.N.length).fill(null), info = [];
  const order = [], seen = new Set(), visit = b => { if (seen.has(b)) return; if (P[b] >= 0) visit(P[b]); seen.add(b); order.push(b); };
  for (let b = 0; b < src.N.length; b++) visit(b);
  for (const b of order) {
    const n = src.N[b], as = axisOf(n, Js, P), ad = axisOf(n, Jd, P);
    if (!as || !ad || len(as) < 1e-6 || len(ad) < 1e-6) { C[b] = P[b] >= 0 ? C[P[b]] : I; continue; }
    const Fs = frame(as, twistOf(n, Js)), Fd = frame(ad, twistOf(n, Jd));
    C[b] = Fs && Fd ? mul(Fs, T3(Fd)) : I;
    info.push([n, Math.acos(Math.max(-1, Math.min(1, dot(nrm(as), nrm(ad))))) * 180 / Math.PI]);
  }
  return { C, info };
}

/**
 * Moves a reference character's frames onto a new skeleton. R: the reference (rig.mjs loadRig). dst: { N, J } the new
 * bind joints in the same order as R.N (metres, the body's frame). Returns { frames (Float32Array, 12 per bone per frame,
 * as the bake), k (hip ratio), align (per bone: degrees between the two bind directions) }.
 * opts.seatedHold: clip names whose hips keep the reference's height above the ground (a seat stays a seat's height).
 */
export function retarget(R, dst, { from = 0, count = R.man.anim.frames, seated = null, delta = null } = {}) {
  const { NB, P, idx } = R, hips = idx.Hips;
  const { C, info } = alignments(R, dst, P);
  if (delta) for (let b = 0; b < NB; b++) if (delta.has(R.N[b])) C[b] = I;
  const order = R.order, Jd = dst.J, Js = R.J;
  const k = Jd[hips][1] / Js[hips][1];
  // which frames belong to a seated clip (their hips' height kept)
  const keepY = new Uint8Array(count);
  if (seated) for (const c of R.man.clips) if (seated.has(c.name)) for (let f = c.off; f < c.off + c.len; f++) if (f >= from && f < from + count) keepY[f - from] = 1;
  const out = new Float32Array(count * NB * 12), Rt = new Array(NB), X = new Array(NB);
  for (let f = 0; f < count; f++) {
    const fr = from + f;
    for (const b of order) {
      const S = R.M(fr, b), Rs = orthonormal(S);
      Rt[b] = mul(Rs, C[b]);
      if (b === hips) {
        const xs = app(S, Js[b]), d = sub(xs, Js[b]);
        X[b] = [Jd[b][0] + d[0] * k, keepY[f] ? xs[1] : Jd[b][1] + d[1] * k, Jd[b][2] + d[2] * k];
      } else {
        const p = P[b];
        X[b] = add(X[p], rotv(Rt[p], sub(Jd[b], Jd[p])));
      }
      const t = sub(X[b], rotv(Rt[b], Jd[b])), o = (f * NB + b) * 12, m = Rt[b];
      out[o] = m[0]; out[o + 1] = m[1]; out[o + 2] = m[2]; out[o + 3] = t[0];
      out[o + 4] = m[4]; out[o + 5] = m[5]; out[o + 6] = m[6]; out[o + 7] = t[1];
      out[o + 8] = m[8]; out[o + 9] = m[9]; out[o + 10] = m[10]; out[o + 11] = t[2];
    }
  }
  return { frames: out, k, align: info };
}
