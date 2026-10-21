// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import test from 'node:test';
import * as THREE from 'three';
import { createVehicleAsset, disposeVehicleAssetCache, VEHICLE_MODEL_MAP, VEHICLE_ASSET_BUDGET } from '../client/js/render/vehicle-assets.js';

const kinds = [
  { n: 'sedan', L: 4.5, W: 1.82, H: 1.44 }, { n: 'compact', L: 3.9, W: 1.74, H: 1.5 },
  { n: 'suv', L: 4.8, W: 1.95, H: 1.78 }, { n: 'van', L: 5.4, W: 2.0, H: 2.25 },
  { n: 'taxi', L: 4.6, W: 1.82, H: 1.46 }, { n: 'bus', L: 11.6, W: 2.55, H: 3.15 },
];

function assetGroup(a) {
  const group = new THREE.Group();
  for (const p of a.parts) group.add(new THREE.Mesh(p.geometry, p.material));
  for (const w of a.wheels) { const mesh = new THREE.Mesh(a.wheel.geometry, a.wheel.material); mesh.position.set(...w.centre); group.add(mesh); }
  group.updateMatrixWorld(true); return group;
}

test('every Next vehicle maps to an actual classic geometry builder within bounded draw/triangle budgets', () => {
  for (const k of kinds) {
    const a = createVehicleAsset(k);
    assert.equal(a.sourceType, VEHICLE_MODEL_MAP[k.n]);
    assert.equal(a.provenance, 'My Virtual World Classic');
    assert.ok(a.parts.length + 1 <= VEHICLE_ASSET_BUDGET.materials);
    assert.ok(a.triangles > 10000 && a.triangles <= VEHICLE_ASSET_BUDGET.triangles);
  }
});

test('production merged vehicle positions, normals and colors are finite, centred and grounded inside existing footprints', () => {
  for (const k of kinds) {
    const a = createVehicleAsset(k), group = assetGroup(a), box = new THREE.Box3().setFromObject(group);
    group.traverse(p => {
      if (!p.isMesh) return;
      for (const attr of ['position', 'normal', 'color']) {
        const data = p.geometry.getAttribute(attr); assert.ok(data);
        assert.ok([...data.array].every(Number.isFinite));
      }
    });
    const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    assert.ok(Math.abs(box.min.y) < 1e-5);
    assert.ok(Math.abs(centre.x) < 1e-5 && Math.abs(centre.z) < 1e-5);
    assert.ok(size.x <= k.W + 1e-5 && size.y <= k.H + 1e-5 && size.z <= k.L + 1e-5);
    assert.ok(size.z > size.x * 1.7, 'length follows the forward +Z axis');
  }
});

test('body paint tint is isolated from glass, wheels and fixed taxi/bus colors', () => {
  for (const k of kinds) {
    const a = createVehicleAsset(k);
    assert.equal(a.parts.filter(p => p.tint).length, ['taxi', 'bus'].includes(k.n) ? 0 : 1);
    for (const p of a.parts) if (p.tint) {
      assert.ok(p.sourceNames.every(n => /Paint$/.test(n)));
      assert.equal(p.material.transparent, false);
    }
    assert.ok(a.parts.some(p => p.material.transparent), 'original glazing retained');
    assert.ok(a.wheel.geometry.attributes.position.count > 0, 'curved road wheels retained');
  }
});

test('geometry caches are reused and have explicit whole-cache teardown', () => {
  const k = kinds[0], a = createVehicleAsset(k); assert.equal(createVehicleAsset(k), a);
  let disposed = 0; for (const p of a.parts) p.geometry.addEventListener('dispose', () => disposed++);
  a.wheel.geometry.addEventListener('dispose', () => disposed++); a.beam.addEventListener('dispose', () => disposed++);
  disposeVehicleAssetCache(); assert.equal(disposed, a.parts.length + 2);
  assert.notEqual(createVehicleAsset(k), a);
  assert.throws(() => createVehicleAsset({ n: 'unknown', L: 1, W: 1, H: 1 }), /No imported/);
});

test('both outward wheel-hub faces are present after the native-axis normalization', () => {
  for (const k of kinds) {
    const a = createVehicleAsset(k);
    assert.equal(a.wheels.length, 4);
    const group = assetGroup(a);
    for (const wheel of a.wheels) {
      const [x, y, z] = wheel.centre, side = Math.sign(x);
      const ray = new THREE.Raycaster(new THREE.Vector3(side * k.W, y, z), new THREE.Vector3(-side, 0, 0));
      const hits = ray.intersectObject(group, true);
      assert.ok(hits.length, `${k.n}: outward hub surface`);
      assert.ok(hits[0].face.normal.x * side > 0.8, `${k.n}: outward-facing hub normal`);
      assert.ok(hits[0].point.x * side > Math.abs(x), `${k.n}: hub outside its wheel centre`);
    }
  }
});

test('legacy lane geometry, spawn/density, following, signal timing and clocked simulation remain byte-identical behind authoritative dispatch', () => {
  const source = fs.readFileSync(new URL('../client/js/render/traffic.js', import.meta.url), 'utf8').replace('if (this.app.driving?.ready) return this.app.driving.byId.size; ', '');
  const baseline = JSON.parse(fs.readFileSync(new URL('./fixtures/traffic-behavior-baseline.json', import.meta.url), 'utf8'));
  for (const [name, b] of Object.entries(baseline)) {
    const start = source.indexOf(b.start), end = name === 'step' && source.includes('  renderNetwork()') ? '  renderNetwork()' : b.end;
    const region = source.slice(start, source.indexOf(end, start));
    assert.equal(crypto.createHash('sha256').update(region).digest('hex'), b.sha256, name);
  }
});

test('vendored geometry preserves deployed semantics and original licensing without private runtime data', () => {
  const dir = new URL('../client/js/render/vehicles-classic/', import.meta.url);
  const provenance = JSON.parse(fs.readFileSync(new URL('PROVENANCE.json', dir), 'utf8'));
  assert.equal(provenance.models.length, 14);
  for (const m of provenance.models) {
    const bytes = fs.readFileSync(new URL(m.file, dir));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), m.vendoredSHA256);
  }
  assert.ok(fs.readFileSync(new URL('LICENSE', dir), 'utf8').includes('PolyForm Noncommercial License 1.0.0'));
});
