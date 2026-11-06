// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Shaders compiled before they are first drawn (2026-11-06: "opening the first few buildings takes an additional
// long time"). A browser compiles a shader the first time something is drawn with it and holds that frame: ~0.25 s a
// shader on the phone, and a floor looked into for the first time needed 4-9 of them (its furniture, floor, walls and
// glass, people's held things, the Amazon models, and the shadows of all these: ~1.2 s held on the phone with no shader in
// the browser's cache). Stand-ins drawn the way the world draws a material (instanced or not, receiving shadows or not)
// and the way its shadow is drawn (three.js's shadow pass: its own depth material, or the thing's own, set up from the
// material: the other side, its map and alpha) are compiled instead under the loading screen or in the background
// (KHR_parallel_shader_compile where the browser has it), so the first frame that draws them finds their shaders ready.
import * as THREE from 'three';

const GEO = new THREE.PlaneGeometry(0.01, 0.01);
const SHADOW_SIDE = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
let shadowTarget = null;   // a target like the sun's shadow map (linear, no tone mapping): what a shadow's shader is made for

/**
 * Stand-ins for mat drawn as the world draws it, added to out = { draw: [], shadow: [] }: geo (its geometry, if it has
 * attributes that change the shader: vertex colours, a second uv set), instanced (an InstancedMesh; colors: with a
 * colour each), batched (a BatchedMesh), cast (it casts a shadow: its shadow's stand-in too, with depth = its own depth
 * material if it has one), receive (it receives shadows).
 */
export function standIns(mat, { geo = GEO, instanced = false, batched = false, cast = true, receive = true, depth = null, colors = false } = {}, out = { draw: [], shadow: [] }) {
  const mk = m => {
    const o = batched ? new THREE.BatchedMesh(1, 8, 8, m) : instanced ? new THREE.InstancedMesh(geo, m, 1) : new THREE.Mesh(geo, m);
    if (batched) o.addGeometry(geo);   // (its attributes: a BatchedMesh has none until then, and normals change the shader)
    if (instanced && colors) o.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
    o.castShadow = cast; o.receiveShadow = receive; o.frustumCulled = false;
    return o;
  };
  out.draw.push(mk(mat));
  if (cast) {
    // (as three.js's WebGLShadowMap getDepthMaterial sets the depth material up for this material, PCF shadows)
    const d = depth || new THREE.MeshDepthMaterial();
    Object.assign(d, { side: mat.shadowSide ?? SHADOW_SIDE[mat.side], map: mat.map, alphaMap: mat.alphaMap, alphaTest: mat.alphaToCoverage ? 0.5 : mat.alphaTest,
      displacementMap: mat.displacementMap, displacementScale: mat.displacementScale, clipShadows: mat.clipShadows, clippingPlanes: mat.clippingPlanes, wireframe: mat.wireframe });
    out.shadow.push(mk(d));
  }
  return out;
}

/**
 * Compile stand-ins (standIns) for the stage (render/scene.js): their own shaders for how this quality draws (into the
 * bloom's target on High, as Stage.compileForDrawing), their shadows' for the shadow map. A promise, resolved once all
 * are ready to draw (at once where the browser has no KHR_parallel_shader_compile: then they are compiled here).
 */
export function compileStandIns(stage, { draw, shadow }) {
  const r = stage.renderer, g = new THREE.Group(), s = new THREE.Group();
  for (const o of draw) g.add(o);
  for (const o of shadow) s.add(o);
  const prev = r.getRenderTarget(), jobs = [];
  if (draw.length) jobs.push(stage.compileForDrawing(stage.camera, g));
  if (shadow.length && stage.q.shadows) {
    // (three.js draws a shadow with no scene: no fog, which would make another shader)
    const fog = stage.scene.fog;
    shadowTarget ||= new THREE.WebGLRenderTarget(1, 1);
    r.setRenderTarget(shadowTarget); stage.scene.fog = null;
    try { jobs.push(r.compileAsync(s, stage.camera, stage.scene)); } finally { stage.scene.fog = fog; r.setRenderTarget(prev); }
  }
  return Promise.all(jobs);
}
