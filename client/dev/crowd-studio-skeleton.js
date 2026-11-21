// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Crowd Studio's skeleton (2026-11-20, the product owner: "include skeletal view and skeletal control of each
// individual component and also manipulate the skeleton for a specific animation so that they can be updated on the
// fly"): the body's bones drawn over the resident as it plays (each joint where its bone and its parent's meet — found
// from the animation's own frames — carried by the frame shown), a joint picked by clicking it or from the list, and
// turned with three sliders: the tuning's bones (shared/crowd-tuning.js cleanBones / applyRig), for every animation of
// the body or only the one playing, mirrored to the other side if asked.
import * as THREE from 'three';
import { pivot, parentName, BONE_LIMIT } from '/shared/crowd-tuning.js';

/** A bone's name in plain words (the builder's skeleton, Mixamo's names). */
export function boneLabel(n) {
  const side = n.startsWith('Left') ? 'Left ' : n.startsWith('Right') ? 'Right ' : '', r = side ? n.slice(side.length - 1) : n;
  const fixed = { Hips: 'Hips (the whole body)', Spine: 'Lower back', Spine1: 'Middle back', Spine2: 'Chest', Neck: 'Neck', Head: 'Head',
    Shoulder: 'collarbone', Arm: 'upper arm (shoulder)', ForeArm: 'forearm (elbow)', Hand: 'hand (wrist)', UpLeg: 'thigh (hip joint)', Leg: 'shin (knee)', Foot: 'foot (ankle)', ToeBase: 'toes' };
  if (fixed[r]) return side + fixed[r];
  const m = /^Hand(Thumb|Index|Middle|Ring|Pinky)(\d)$/.exec(r);
  if (m) return `${side}${m[1].toLowerCase()} ${['', 'base', 'middle', 'tip'][+m[2]] || m[2]}`;
  return side + r;
}
/** The list's groups: [label, test]. */
const GROUPS = [
  ['Back, neck and head', n => /^(Hips|Spine|Spine1|Spine2|Neck|Head)$/.test(n)],
  ['Left arm', n => /^Left(Shoulder|Arm|ForeArm|Hand)$/.test(n)], ['Right arm', n => /^Right(Shoulder|Arm|ForeArm|Hand)$/.test(n)],
  ['Left fingers', n => /^LeftHand(Thumb|Index|Middle|Ring|Pinky)[123]$/.test(n)], ['Right fingers', n => /^RightHand(Thumb|Index|Middle|Ring|Pinky)[123]$/.test(n)],
  ['Left leg', n => /^Left(UpLeg|Leg|Foot|ToeBase)$/.test(n)], ['Right leg', n => /^Right(UpLeg|Leg|Foot|ToeBase)$/.test(n)],
];
export const AXES = [['Bend back', 'Bend forward'], ['Turn right', 'Turn left'], ['Tilt left', 'Tilt right']];
/** The other side's bone (Left… ↔ Right…), or null. */
export const mirrorOf = n => (n.startsWith('Left') ? 'Right' + n.slice(4) : n.startsWith('Right') ? 'Left' + n.slice(5) : null);
/** A turn as the other side's: about x the same, about y and z back. */
export const mirrored = v => [v[0], -v[1], -v[2]];
export const boneGroups = names => GROUPS.map(([label, ok]) => [label, names.filter(ok)]).filter(([, l]) => l.length);

/**
 * The skeleton drawn over resident 0 of `C` (render/characters.js), the clip and moment of `state`; `pickAt(x, y)` → the
 * joint under a point of the canvas (or null). { group, update(), pickAt(ev), names, setSelected(name) }.
 */
export function makeSkeleton({ C, getState, cam, canvas }) {
  const group = new THREE.Group(); group.visible = false; group.renderOrder = 10;
  const jointMat = new THREE.MeshBasicMaterial({ color: 0x6fd3ff, depthTest: false, transparent: true, opacity: 0.95 });
  const selMat = new THREE.MeshBasicMaterial({ color: 0xff9a2e, depthTest: false });
  const editMat = new THREE.MeshBasicMaterial({ color: 0xffe14d, depthTest: false });
  const ball = new THREE.SphereGeometry(0.016, 12, 8);
  const lineGeo = new THREE.BufferGeometry(), lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.85 }));
  lines.renderOrder = 10; group.add(lines);
  let cache = null, selected = null, edited = new Set();
  /** The body's joints (once per animation data): bind points, parents, a sphere each. */
  const build = () => {
    const d = C.kinds[C.kindOf[0]]?.d, A = d?.anim;
    if (!A?.data || !A.names) return null;
    if (cache && cache.A === A) return cache;
    for (const m of cache?.balls || []) group.remove(m);
    const names = A.names.map(n => String(n).replace(/^mixamorig:/, '')), B = A.bones;
    const parent = names.map(n => names.indexOf(parentName(n) ?? ''));
    const show = names.map(n => !/(_End|4)$/.test(n) && !/HeadTop/.test(n));
    // (from the animation as baked, as applyRig finds them: the turns it then makes turn about the same points)
    const points = names.map((n, j) => (parent[j] < 0 ? null : pivot(A.src || A.data, A.frames, B, j, parent[j])));
    // (the hips: between the two hip joints)
    const hip = names.indexOf('Hips'), l = names.indexOf('LeftUpLeg'), r = names.indexOf('RightUpLeg');
    if (hip >= 0 && points[l] && points[r]) points[hip] = [0, 1, 2].map(i => (points[l][i] + points[r][i]) / 2);
    const balls = names.map((n, j) => { if (!show[j] || !points[j]) return null; const m = new THREE.Mesh(ball, jointMat); m.renderOrder = 11; m.userData.bone = n; group.add(m); return m; });
    const pairs = names.map((n, j) => (show[j] && points[j] && parent[j] >= 0 && points[parent[j]] && show[parent[j]] ? [parent[j], j] : null)).filter(Boolean);
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pairs.length * 6), 3));
    cache = { A, names, B, parent, points, balls, pairs, d };
    return cache;
  };
  const HALF = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023; HALF[h] = e === 0 ? s * f * 2 ** -24 : e === 31 ? (f ? NaN : s * Infinity) : s * (1 + f / 1024) * 2 ** (e - 15); }
  const posed = new Map();
  let lastF = -1;
  /** Each joint where the frame shown carries it (the resident's height and build as the renderer scales them). */
  const update = () => {
    if (!group.visible) return;
    const c = build(); if (!c) return;
    const state = getState();
    const clip = (c.A.clips || []).find(x => x.name === state.clip); if (!clip) return;
    const n = Math.max(1, Math.abs(Math.round(clip.len))), f = Math.round(clip.off) + Math.min(n - 1, Math.floor(state.phase * n));
    lastF = f;
    const [H, Bd] = C.bodyScale?.(0) || [1, 1];
    c.names.forEach((nm, j) => {
      const p = c.points[j]; if (!p) return;
      const o = (f * c.B + j) * 12, m = i => HALF[c.A.data[o + i]];
      const x = m(0) * p[0] + m(1) * p[1] + m(2) * p[2] + m(3), y = m(4) * p[0] + m(5) * p[1] + m(6) * p[2] + m(7), z = m(8) * p[0] + m(9) * p[1] + m(10) * p[2] + m(11);
      const v = posed.get(j) || new THREE.Vector3(); v.set(x * H * Bd, y * H, z * H * Bd); posed.set(j, v);
      const b = c.balls[j]; if (b) { b.position.copy(v); b.material = nm === selected ? selMat : edited.has(nm) ? editMat : jointMat; b.scale.setScalar(nm === selected ? 1.5 : 1); }
    });
    const arr = lineGeo.attributes.position.array;
    c.pairs.forEach(([a, b], i) => { const A = posed.get(a), Bv = posed.get(b); if (!A || !Bv) return; arr.set([A.x, A.y, A.z, Bv.x, Bv.y, Bv.z], i * 6); });
    lineGeo.attributes.position.needsUpdate = true; lineGeo.computeBoundingSphere();
  };
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  /** The joint under a click (or null). */
  const pickAt = ev => {
    if (!group.visible || !cache) return null;
    const r = canvas.getBoundingClientRect(); ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    // (the nearest joint to the ray, within a few pixels' reach: small balls are hard to hit)
    let best = null, bd = 0.035;
    for (const b of cache.balls) { if (!b) continue; const d = ray.ray.distanceToPoint(b.position); if (d < bd) { bd = d; best = b.userData.bone; } }
    return best;
  };
  /** Where bone `name`'s joint stands in the frame shown, and how the bone is turned there (its bind axes as carried):
   *  { pos: Vector3, quat: Quaternion } — for the rings that turn it. */
  const frameOf = name => {
    const c = cache; if (!c || lastF < 0) return null;
    const j = c.names.indexOf(name); if (j < 0 || !posed.get(j)) return null;
    const o = (lastF * c.B + j) * 12, m = i => HALF[c.A.data[o + i]];
    const M = new THREE.Matrix4().set(m(0), m(1), m(2), 0, m(4), m(5), m(6), 0, m(8), m(9), m(10), 0, 0, 0, 0, 1);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(M));
    return { pos: posed.get(j).clone(), quat: q.normalize() };
  };
  /** The joints of `names` in the frame shown, unscaled (the animation's own space) — { pos: { name: Vector3 }, quat:
   *  { name: Quaternion }, scale: [height, build] } — for moving a joint (the bones above it turned to reach). */
  const poseOf = names => {
    const out = { pos: {}, quat: {}, scale: C.bodyScale?.(0) || [1, 1] }, c = cache;
    if (!c || lastF < 0) return null;
    for (const n of names) {
      const j = c.names.indexOf(n), p = c.points[j]; if (j < 0 || !p) return null;
      const o = (lastF * c.B + j) * 12, m = i => HALF[c.A.data[o + i]];
      out.pos[n] = new THREE.Vector3(m(0) * p[0] + m(1) * p[1] + m(2) * p[2] + m(3), m(4) * p[0] + m(5) * p[1] + m(6) * p[2] + m(7), m(8) * p[0] + m(9) * p[1] + m(10) * p[2] + m(11));
      out.quat[n] = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().set(m(0), m(1), m(2), 0, m(4), m(5), m(6), 0, m(8), m(9), m(10), 0, 0, 0, 0, 1)).normalize();
    }
    return out;
  };
  /** Bone `name`'s parent's name (or null). */
  const parentOf = name => { const c = build(); if (!c) return null; const j = c.names.indexOf(name), p = j >= 0 ? c.parent[j] : -1; return p >= 0 ? c.names[p] : null; };
  return {
    group, update, pickAt, frameOf, poseOf, parentOf,
    names: () => build()?.names || [],
    setSelected: n => { selected = n; }, setEdited: list => { edited = new Set(list); },
    reset: () => { cache = null; },
  };
}
export { BONE_LIMIT };
