// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Pictures of the signs' styles for the style picker (ui/sign-design.js): each sign model drawn once, three-quarter on,
// in its colour, by a small renderer of its own (made for a batch and given back after it, so it holds no GPU context).
import * as THREE from 'three';
import { furnitureGeometry } from './furniture.js';
import { makeFurnMat } from './mats.js';
import { indoorSignFaces, parseSignGeoKey } from '/shared/signs.js';

const cache = new Map();   // key|colour → data URL

/**
 * Data URLs of the models `keys` (render/furniture.js geometry keys, e.g. 'sign_stand@halo#0.90x1.20') in colour `color`, each
 * size × size pixels. Resolves { key: url }.
 */
export async function signThumbs(keys, color = '#38bdf8', size = 168) {
  const out = {}, todo = keys.filter(k => { const c = cache.get(`${k}|${color}`); if (c) out[k] = c; return !c; });
  if (!todo.length) return out;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(size, size, false); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
    scene.add(new THREE.HemisphereLight(0xf2f5ff, 0x3a3f48, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(2.5, 4, 3.5); scene.add(sun);
    const mat = makeFurnMat({ lit: false }), glass = makeFurnMat({ glass: true }), col = new THREE.Color(color);
    for (const key of todo) {
      const G = furnitureGeometry(key), meshes = [];
      for (const [geo, m] of [[G.geo, mat], [G.glass, glass]]) {
        if (!geo) continue;
        const im = new THREE.InstancedMesh(geo, m, 1); im.setMatrixAt(0, new THREE.Matrix4()); im.setColorAt(0, col); im.frustumCulled = false;
        scene.add(im); meshes.push(im);
      }
      // the sign's face, as a light panel (the design is drawn on it in the world)
      const P = parseSignGeoKey(key);
      if (P) for (const F of indoorSignFaces({ t: P.t, fw: P.w, fh: P.h })) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(F.w, F.h), new THREE.MeshBasicMaterial({ color: 0xe9edf2 }));
        p.position.set(F.x, F.y, F.z); p.rotation.y = F.yaw; scene.add(p); meshes.push(p);
      }
      G.geo.computeBoundingBox();
      const b = G.geo.boundingBox, c = b.getCenter(new THREE.Vector3()), r = b.getSize(new THREE.Vector3()).length() / 2;
      const d = r / Math.sin(THREE.MathUtils.degToRad(15)) * 0.98;
      cam.position.set(c.x + d * 0.55, c.y + d * 0.18, c.z + d * 0.82); cam.lookAt(c);
      renderer.render(scene, cam);
      out[key] = canvas.toDataURL('image/png');
      cache.set(`${key}|${color}`, out[key]);
      for (const m of meshes) { scene.remove(m); if (m.isMesh && !m.isInstancedMesh) { m.geometry.dispose(); m.material.dispose(); } }
    }
    mat.dispose(); glass.dispose();
  } catch { /* no WebGL: the picker shows names only */ }
  finally { renderer?.dispose(); renderer?.forceContextLoss?.(); }
  return out;
}
