// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { rigBatchForKind } from '../shared/rigProfiles.js';

function fixture() {
  class Material { constructor(options) { Object.assign(this, options); } }
  class Vector { constructor(...values) { this.values = values; } }
  const context = {
    THREE: { MeshStandardMaterial: Material, MeshDepthMaterial: Material, Vector2: Vector, Vector4: Vector, RGBADepthPacking: 3201 },
    VERT_PARS: 'VERT', FRAG_PARS: 'FRAG', PLACE: 'PLACE', RIM: 'RIM', rigBatchForKind,
  };
  vm.createContext(context);
  const source = fs.readFileSync(new URL('../client/js/render/characters.js', import.meta.url), 'utf8');
  vm.runInContext(source.slice(source.indexOf('export class Characters'))
    .replace('export class Characters', 'class Characters').replace('export { TRIPO_CLIPS };', '')
    + '\nglobalThis.C = Characters;', context);
  const renderer = Object.create(context.C.prototype);
  const pair = () => ({ male: {}, female: {} });
  const rigBatchU = { batch1: pair(), batch2: pair() };
  Object.assign(renderer, { appUniform: {}, indoor: {}, uTime: {}, lidForce: {}, rigU: rigBatchU.batch1, rigBatchU });
  const data = token => ({ tex: token, off: [], len: [], colorMap: {}, normalMap: {}, man: { land: { waist: 0.9, neckY: 1.6 } } });
  return { renderer, data };
}

test('old/new model IDs reuse identical shader programs while material uniforms stay independent', () => {
  const { renderer, data } = fixture();
  const oldData = data('old animation'), newData = data('new animation');
  const old = renderer.makeMaterial('m01', oldData, false, true);
  const added = renderer.makeMaterial('f22', newData, false, true);
  assert.equal(old.customProgramCacheKey(), added.customProgramCacheKey());
  const shader = () => ({ uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>' });
  const a = shader(), b = shader();old.onBeforeCompile(a);added.onBeforeCompile(b);
  assert.equal(a.uniforms.uAnim.value, 'old animation');assert.equal(b.uniforms.uAnim.value, 'new animation');
  assert.notEqual(a.uniforms.uLand, b.uniforms.uLand);
  assert.equal(a.vertexShader, b.vertexShader);assert.equal(a.fragmentShader, b.fragmentShader);
});

test('depth/plain/normal variants keep distinct shader keys', () => {
  const { renderer, data } = fixture();
  const keys = [renderer.makeMaterial('m01', data('x'), true, false), renderer.makeMaterial('m01', data('x'), false, false), renderer.makeMaterial('m20', data('x'), false, true)].map(m => m.customProgramCacheKey());
  assert.equal(new Set(keys).size, 3);
});
