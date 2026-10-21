// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Geometry authored by My Virtual World, imported from the models served by the classic release.
// This adapter only normalizes +X-forward/scale=2 to Next's +Z-forward/floor origin,
// preserves automotive proportions and batches by source material for instancing.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createTrafficVehicleModelDefinition } from './vehicles-classic/traffic-vehicle-models.mjs';
import { buildClassicSedan, disposeClassicSedanGeometry } from './vehicles-classic/classic-sedan-renderer.mjs';
import { buildRealisticFleetVehicle, disposeFleetVehicleGeometry } from './vehicles-classic/fleet-vehicle-renderer.mjs';
import { tagVehicleLenses, createVehicleBeamGeometry } from './vehicle-effects.js';

export const VEHICLE_MODEL_MAP = Object.freeze({ sedan: 'sedan', compact: 'car', suv: 'suv', van: 'van', taxi: 'taxi', bus: 'bus' });
export const VEHICLE_ASSET_BUDGET = Object.freeze({ materials: 4, triangles: 30000 });
const cache = new Map();

function materialKey(m, tint) {
  return JSON.stringify([m.type, m.color?.getHex(), m.emissive?.getHex(), m.specular?.getHex(), m.shininess,
    m.transparent, m.opacity, m.side, m.depthWrite, m.vertexColors, m.flatShading, m.toneMapped, tint]);
}

export function createVehicleAsset(kind) {
  const key = `${kind.n}/${kind.L}/${kind.W}/${kind.H}`;
  if (cache.has(key)) return cache.get(key);
  const sourceType = VEHICLE_MODEL_MAP[kind.n];
  if (!sourceType) throw new Error(`No imported vehicle model for ${kind.n}`);
  const group = new THREE.Group(), details = new THREE.Group(); group.add(details);
  const definition = createTrafficVehicleModelDefinition(sourceType, 0xffffff);
  const deps = { THREE, getMat: (color, options) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...options }), mergeStaticGroupMeshes: () => {} };
  (sourceType === 'car' || sourceType === 'sedan' ? buildClassicSedan : buildRealisticFleetVehicle)(group, definition, 0xffffff, details, deps);
  group.rotation.y = -Math.PI / 2; // the classic release's +X nose now points along Next's +Z lane.
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group), size = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3()); centre.y = bounds.min.y;
  const scale = Math.min(kind.W / size.x, kind.H / size.y, kind.L / size.z);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid vehicle dimensions');
  const normalize = new THREE.Matrix4().makeScale(scale, scale, scale);
  normalize.setPosition(centre.multiplyScalar(-scale));
  const buckets = new Map(), sourceMaterials = new Set(), wheels = [];
  const lampBounds = { front: [new THREE.Box3(), new THREE.Box3()], rear: [new THREE.Box3(), new THREE.Box3()] };
  const lampCounts = { front: 0, rear: 0 };
  let wheel = null;
  const fixedPaint = group.userData.fleetDimensions?.paint != null;
  group.traverse(mesh => {
    if (!mesh.isMesh) return;
    const material = mesh.material;
    if (Array.isArray(material)) throw new Error('Unexpected source vehicle material array');
    sourceMaterials.add(material);
    const matrix = new THREE.Matrix4().multiplyMatrices(normalize, mesh.matrixWorld);
    const geometry = mesh.geometry.clone(); geometry.applyMatrix4(matrix);
    if (mesh.name === 'wheel') {
      const centre = new THREE.Vector3().applyMatrix4(matrix).toArray();
      if (!wheel) {
        geometry.translate(-centre[0], -centre[1], -centre[2]);
        let radius = 0; const p = geometry.attributes.position;
        for (let i = 0; i < p.count; i++) radius = Math.max(radius, Math.hypot(p.getY(i), p.getZ(i)));
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        wheel = { geometry, material: material.clone(), radius };
      } else geometry.dispose();
      wheels.push({ centre, radius: wheel.radius }); return;
    }
    const counts = tagVehicleLenses(geometry, sourceType, mesh.name);
    lampCounts.front += counts.front; lampCounts.rear += counts.rear;
    const p = geometry.attributes.position, flags = geometry.attributes.aVehicleLamp;
    for (let i = 0; i < p.count; i++) if (flags.getX(i) > 0) {
      const mode = flags.getX(i) === 1 ? 'front' : 'rear', side = p.getX(i) < 0 ? 0 : 1;
      lampBounds[mode][side].expandByPoint(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
    }
    const tint = /Paint$/.test(mesh.name) && !fixedPaint;
    const signature = materialKey(material, tint);
    let bucket = buckets.get(signature);
    if (!bucket) {
      const m = material.clone();
      if (m.transparent) m.forceSinglePass = true;
      bucket = { material: m, tint, lit: false, geometries: [], names: [] }; buckets.set(signature, bucket);
    }
    bucket.lit ||= counts.front + counts.rear > 0;
    bucket.geometries.push(geometry); bucket.names.push(mesh.name);
  });
  const parts = [...buckets.values()].map(b => {
    const geometry = mergeGeometries(b.geometries, false);
    if (!geometry) throw new Error('Vehicle material batch failed to merge');
    for (const g of b.geometries) g.dispose();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return { geometry, material: b.material, tint: b.tint, lit: b.lit, sourceNames: b.names };
  }).sort((a, b) => Number(b.tint) - Number(a.tint) || Number(a.material.transparent) - Number(b.material.transparent));
  for (const material of sourceMaterials) material.dispose();
  if (!wheel || wheels.length !== 4 || !lampCounts.front || !lampCounts.rear) throw new Error('Vehicle wheel/lamp rig is incomplete');
  const lamps = Object.fromEntries(Object.entries(lampBounds).map(([mode, bounds]) => [mode, bounds.map(box => {
    if (box.isEmpty()) throw new Error(`Missing ${mode} vehicle lens`);
    const p = box.getCenter(new THREE.Vector3()); if (mode === 'front') p.z = box.max.z; return p.toArray();
  })]));
  const triangles = parts.reduce((n, p) => n + (p.geometry.index?.count || p.geometry.attributes.position.count) / 3, 0) + wheel.geometry.attributes.position.count / 3 * wheels.length;
  if (parts.length + 1 > VEHICLE_ASSET_BUDGET.materials || triangles > VEHICLE_ASSET_BUDGET.triangles) throw new Error('Imported vehicle exceeds render budget');
  const beamLength = Math.min(12, Math.max(7, kind.L * 1.8)), beam = createVehicleBeamGeometry(lamps.front, beamLength);
  const asset = { sourceType, parts, wheel, wheels, lamps, lampCounts, beam, beamLength, scale, triangles, radius: Math.hypot(kind.L, kind.W, kind.H) / 2, provenance: 'My Virtual World Classic' };
  cache.set(key, asset); return asset;
}

// Whole-cache teardown only after all traffic instances have gone; never for one deleted car.
export function disposeVehicleAssetCache() {
  for (const asset of cache.values()) {
    for (const p of asset.parts) { p.geometry.dispose(); p.material.dispose(); }
    asset.wheel.geometry.dispose(); asset.wheel.material.dispose(); asset.beam.dispose();
  }
  cache.clear(); disposeClassicSedanGeometry(THREE); disposeFleetVehicleGeometry(THREE);
}
