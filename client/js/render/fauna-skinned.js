// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Modelled animals for the wildlife (2026-11-11, the product owner: "replace the current wild horse models which are
// primitives with the Tripo versions" and "change its colour to its hair and body"). A species whose catalogue entry
// names an `asset` (shared/world-config/species/<id>.json) is drawn from a baked, skinned model instead of the built
// model of render/fauna-models.js:
//   <asset>.json   the manifest: bones, three levels of detail, the clips, the textures, the recolour references
//   <asset>.bin    the meshes (position, normal, uv, 4 bone slots and weights, indices) and the clips' bone matrices
//   color / mask   the painted texture and its recolour mask (r: body coat, g: mane and tail, b: lower legs)
// Each level of detail is one instanced draw. The bones are posed in the vertex shader from a float texture of
// matrices (3 texels a bone, one row a frame), each animal at its own clip, phase and rate; its coat comes from three
// per-instance colours (body, hair, legs) that replace the painted ones by the mask, keeping the painted shading.
// Clips: rest (standing, grazing, looking up again), walk, trot, run; a bird's also fly, glide and swim (2026-11-12:
// tools/animals/bird_animal.py). Forward +x, up +y, metres at size 1.
import * as THREE from 'three';
import { GU } from './scene.js';

const CLIP_OF_MODE = { 0: 'rest', 1: 'walk', 2: 'run', 3: 'trot', 4: 'fly', 5: 'glide', 6: 'swim' };
const CLIP_NAMES = ['rest', 'walk', 'run', 'trot', 'fly', 'glide', 'swim'];

// The folders' versions (server/asset-compress.js: /assets/fauna/version.json, /assets/fish/version.json): every file of a
// model asked for at its folder's version, which the browser may keep a year (2026-11-14: each visit downloaded the
// wildlife's 50 MB again) and the server sends compressed.
const folderVer = new Map();
const versionOf = root => {
  if (!folderVer.has(root)) folderVer.set(root, fetch(`${root}version.json`, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : {})).then(j => j.v || '').catch(() => ''));
  return folderVer.get(root);
};
/** Load a skinned animal asset (its manifest URL); resolves to null when it can't be loaded (the caller keeps the built model). */
export async function loadSkinned(url) {
  try {
    const base = url.replace(/[^/]*$/, ''), root = (/^\/assets\/[^/]+\//.exec(url) || [''])[0];
    const v = root ? await versionOf(root) : '', q = n => (v ? `${n}?v=${v}` : n);
    const man = await (await fetch(q(url))).json();
    if (man.v !== 1 || !Array.isArray(man.lods) || !man.anim || !man.clips?.rest) throw new Error('not a skinned animal manifest');
    const buf = await (await fetch(q(base + url.split('/').pop().replace(/\.json$/, '.bin')))).arrayBuffer();
    const at = (off, T, n) => new T(buf, off, n);
    const lods = man.lods.map(L => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(at(L.pos, Float32Array, L.verts * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(at(L.nrm, Float32Array, L.verts * 3), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(at(L.uv, Float32Array, L.verts * 2), 2));
      g.setAttribute('aSkin', new THREE.BufferAttribute(at(L.skin, Uint8Array, L.verts * 4), 4));
      g.setAttribute('aWeight', new THREE.BufferAttribute(at(L.weight, Uint8Array, L.verts * 4), 4, true));
      g.setIndex(new THREE.BufferAttribute(L.indexType === 'u16' ? at(L.index, Uint16Array, L.tris * 3) : at(L.index, Uint32Array, L.tris * 3), 1));
      // bounds generous enough for any pose (the instances are culled by the wildlife code, not by three)
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), man.height * 1.6);
      return g;
    });
    const nb = man.anim.bones, nf = man.anim.frames;
    const bones = new THREE.DataTexture(at(man.anim.offset, Float32Array, nf * nb * 12), nb * 3, nf, THREE.RGBAFormat, THREE.FloatType);
    bones.needsUpdate = true;
    const tl = new THREE.TextureLoader();
    const tex = (n, srgb) => new Promise((ok, no) => tl.load(q(base + n), t => { t.flipY = false; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; ok(t); }, undefined, no));
    const [color, mask] = await Promise.all([tex(man.textures.color, true), tex(man.textures.mask, false)]);
    return { man, lods, bones, color, mask };
  } catch (e) {
    console.warn(`[wildlife] ${url}: the modelled animal could not load (${e.message}); the built model stands in`);
    return null;
  }
}

const VERT = /* glsl */`
attribute vec4 aSkin, aWeight, aAnim, aPrev;
attribute vec3 aBody, aHair, aLegs;
uniform sampler2D uBones;
uniform float uTime;
uniform vec4 uClips[7];   // per clip: first row, frames, fps, 0 (rest, walk, run, trot, fly, glide, swim)
varying vec3 vBody, vHair, vLegs;
mat4 boneAt(int b, int row) {
  vec4 r0 = texelFetch(uBones, ivec2(b * 3, row), 0), r1 = texelFetch(uBones, ivec2(b * 3 + 1, row), 0), r2 = texelFetch(uBones, ivec2(b * 3 + 2, row), 0);
  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0);
}
mat4 skinAt(int row) {
  return boneAt(int(aSkin.x), row) * aWeight.x + boneAt(int(aSkin.y), row) * aWeight.y + boneAt(int(aSkin.z), row) * aWeight.z + boneAt(int(aSkin.w), row) * aWeight.w;
}
mat4 clipSkin(float mode, float rate, float off) {
  vec4 C = uClips[clamp(int(mode + 0.5), 0, 6)];
  float f = fract(uTime * rate + off) * C.y, f0 = floor(f);
  int a = int(C.x + f0), b = int(C.x + mod(f0 + 1.0, C.y));
  return skinAt(a) * (1.0 - (f - f0)) + skinAt(b) * (f - f0);
}
// aAnim: (cycle offset, rate, clip, -); aPrev: the clip it is leaving (offset, rate, clip, when it switched): the two
// are cross-faded over a moment instead of snapping from one to the other
mat4 skinMatrix() {
  mat4 M = clipSkin(aAnim.z, aAnim.y, aAnim.x);
  float w = (uTime - aPrev.w) / 0.45;
  if (w < 1.0 && w >= 0.0) M = clipSkin(aPrev.z, aPrev.y, aPrev.x) * (1.0 - smoothstep(0.0, 1.0, w)) + M * smoothstep(0.0, 1.0, w);
  return M;
}`;

/** The material: the painted texture, recoloured per animal by the mask, posed by the bone texture. Every modelled
 *  species shares one shader program (2026-11-14: one each made 125 programs to compile at start-up and a program
 *  switch per species every frame): what differs between them — the bones, the clips, the mask, the painting's
 *  reference brightness — is in uniforms, so the generated source is the same for all. */
function material(A) {
  // (a fish's scales shine a little: the manifest's roughness, 2026-11-13)
  const m = new THREE.MeshStandardMaterial({ map: A.color, roughness: A.man.roughness ?? 0.85, metalness: A.man.metalness ?? 0 });
  // (a see-through animal, as a jellyfish: its manifest's opacity)
  if (A.man.opacity) { m.transparent = true; m.opacity = A.man.opacity; m.depthWrite = false; m.side = THREE.DoubleSide; }
  const clips = CLIP_NAMES.map(k => {
    const c = A.man.clips[k] || A.man.clips.rest;
    return new THREE.Vector4(c.start, c.frames, c.fps, 0);
  });
  const ref = A.man.refLumLinear || A.man.refLum, uRef = new THREE.Vector3(ref.body, ref.hair, ref.points);
  m.onBeforeCompile = sh => {
    sh.uniforms.uBones = { value: A.bones }; sh.uniforms.uTime = GU.uTime; sh.uniforms.uClips = { value: clips };
    sh.uniforms.uMask = { value: A.mask }; sh.uniforms.uRef = { value: uRef };
    sh.vertexShader = VERT + '\n' + sh.vertexShader
      .replace('#include <beginnormal_vertex>', 'mat4 mvwSkin = skinMatrix();\nvec3 objectNormal = normalize(mat3(mvwSkin) * normal);')
      .replace('#include <begin_vertex>', 'vec3 transformed = (mvwSkin * vec4(position, 1.0)).xyz;\nvBody = aBody; vHair = aHair; vLegs = aLegs;');
    sh.fragmentShader = `uniform sampler2D uMask;\nuniform vec3 uRef;\nvarying vec3 vBody, vHair, vLegs;\n` + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        // the coat: each painted region gives way to its colour, keeping the painting's light and dark
        vec3 k = texture2D(uMask, vMapUv).rgb;
        float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 c = diffuseColor.rgb * clamp(1.0 - k.r - k.g - k.b, 0.0, 1.0)
          + k.r * vBody * (l / uRef.x) + k.g * vHair * (l / uRef.y) + k.b * vLegs * (l / uRef.z);
        diffuseColor.rgb = min(c, vec3(1.0));
      }`);
  };
  m.customProgramCacheKey = () => 'fauna-skinned-1';   // (the same source for every species: see above)
  return m;
}

/**
 * The draws of one modelled species: an instanced mesh per level of detail, filled each frame with put() and closed
 * with end(). coats: [{ body, hair, legs }] as THREE.Colors (working colour space).
 */
export function skinnedPack(A, cap, scene, name, coats) {
  const mat = material(A);
  const meshes = A.lods.map((g0, k) => {
    const g = g0.clone();
    const inst = { aAnim: 4, aPrev: 4, aBody: 3, aHair: 3, aLegs: 3 };
    for (const [n, s] of Object.entries(inst)) g.setAttribute(n, new THREE.InstancedBufferAttribute(new Float32Array(cap * s), s));
    const mesh = new THREE.InstancedMesh(g, mat, cap);
    mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false; mesh.userData.smallCaster = true;
    mesh.matrixAutoUpdate = false;   // (it never moves: its animals are placed by their instance matrices)
    mesh.name = `${name}-lod${k}`;
    scene.add(mesh);
    return mesh;
  });
  const n = meshes.map(() => 0), dist = A.man.lodDist || [35, 90];
  // the coat each slot holds (a slot's colours go to the GPU only when its coat changes: an animal usually keeps its slot)
  const coatAt = meshes.map(() => new Int32Array(cap).fill(-1)), coatDirty = meshes.map(() => false);
  const rest = A.man.clips.rest, restRate = rest.fps / rest.frames;
  return {
    meshes, cap, coats,
    begin() { n.fill(0); },
    get count() { return n.reduce((a, b) => a + b, 0); },
    /** One animal: its matrix, coat index, cycle offset (cycles; or radians/2π if from a phase), rate (cycles/s; for
     *  walking and running), mode (0 rest, 1 walk, 2 run, 3 trot, 4 fly, 5 glide, 6 swim), distance, and optionally the clip it is leaving
     *  ([offset, rate, mode, uTime it switched] — see motion()). */
    put(m4, coat, phase, rate, mode, d, prev = null, cycles = false) {
      const k = d < dist[0] ? 0 : d < dist[1] ? 1 : 2, mesh = meshes[k], i = n[k];
      if (i >= cap) return false;
      mesh.setMatrixAt(i, m4);
      const ci = coat % coats.length, g = mesh.geometry.attributes;
      if (coatAt[k][i] !== ci) {
        const c = coats[ci]; coatAt[k][i] = ci; coatDirty[k] = true;
        g.aBody.setXYZ(i, c.body.r, c.body.g, c.body.b); g.aHair.setXYZ(i, c.hair.r, c.hair.g, c.hair.b); g.aLegs.setXYZ(i, c.legs.r, c.legs.g, c.legs.b);
      }
      g.aAnim.setXYZW(i, cycles ? phase : phase / 6.2832, mode ? rate : restRate, mode, 0);
      if (prev) g.aPrev.setXYZW(i, prev[0], prev[2] ? prev[1] : restRate, prev[2], prev[3]); else g.aPrev.setXYZW(i, 0, 0, 0, -1e6);
      n[k] = i + 1;
      return true;
    },
    end() {
      meshes.forEach((mesh, k) => {
        mesh.count = n[k];
        // an empty draw is left out of the frame altogether: three.js sets up its program, uniforms and buffers before
        // it finds there is nothing to draw (2026-11-14: 90 of them a frame, mostly empty — a slow phone's frame rate
        // went from 23.5 to 26-27 travelling over the island when they were left out)
        mesh.visible = n[k] > 0;
        if (n[k]) {
          mesh.instanceMatrix.needsUpdate = true;
          for (const a of ['aAnim', 'aPrev']) mesh.geometry.attributes[a].needsUpdate = true;
          if (coatDirty[k]) { for (const a of ['aBody', 'aHair', 'aLegs']) mesh.geometry.attributes[a].needsUpdate = true; coatDirty[k] = false; }
        }
      });
    },
  };
}

export { motion } from './fauna-motion.js';

/** The coats of a species: its catalogue `coats` ([{ name, body, hair, legs }] in '#rrggbb'), else the manifest's. */
export function coatsOf(sp, A) {
  const src = Array.isArray(sp.coats) && sp.coats.length ? sp.coats : A.man.coats.map(c => ({ body: c.body, hair: c.hair, legs: c.legs }));
  const col = v => (Array.isArray(v) ? new THREE.Color().setRGB(v[0], v[1], v[2], THREE.SRGBColorSpace) : new THREE.Color(v));
  return src.map(c => ({ body: col(c.body), hair: col(c.hair), legs: col(c.legs) }));
}

export { CLIP_OF_MODE };
