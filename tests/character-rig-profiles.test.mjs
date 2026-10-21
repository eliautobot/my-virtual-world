// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { RIG_BATCHES, RIG_BODIES, RIG_LIMIT, zeroRig, rigBatchForKind,
  normalizeRigSettings, updateRigProfile } from '../shared/rigProfiles.js';
import { TEXTURED } from '../client/assets/chars/index.js';
import { CHARACTERS } from '../shared/appearance.js';
import { TRIPO_CLIPS } from '../client/js/render/charClips.js';
import { COMMON, SKIN_GLSL } from '../client/js/render/char-glsl.js';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
// Exact pre-rollout world values and selected Lab male, recorded in the
// batch2-male-world-20261002/baseline.json audit fixture (no live data access).
const LEGACY = { male: { width: 0.036, height: 0.026, forward: -0.012 },
  female: { width: 0.02, height: 0.026, forward: -0.02 } };
const SELECTED = { width: -0.016, height: 0.006, forward: 0.006 };
const WORLD = JSON.parse(read('../client/assets/chars/rig.json'));
const manifests = Object.fromEntries(TEXTURED.map(kind =>
  [kind, JSON.parse(read(`../client/assets/chars/${kind}.json`))]));
const source = read('../client/js/render/characters.js');
const slots = RIG_BATCHES.flatMap(batch => RIG_BODIES.map(body => ({ batch, body })));
const value = uniform => ({ width: uniform.value.x, height: uniform.value.y, forward: uniform.value.z });
const offsets = p => ({ width: p.width, height: p.height, forward: p.forward });
const request = (batch, body, values) => ({ batch, body, values });
function freeze(object) {
  if (object && typeof object === 'object') { Object.values(object).forEach(freeze); Object.freeze(object); }
  return object;
}
// Execute actual shaders, class, constructor, loadRig and material callbacks.
// Only THREE primitives, fetch and the held-things renderer (render/char-props.js) are mocked; no constructor/method
// overrides.
// capacity=0/lods=[] and wanted=false avoid GPU buffers and background assets.
async function renderer(saved = WORLD, mode = 'ok') {
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
    set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  }
  class Vector4 { constructor(x, y, z, w) { Object.assign(this, { x, y, z, w }); } }
  class Material { constructor(options) { Object.assign(this, options); } }
  const requests = [], start = source.indexOf('const VERT_PARS ='), end = source.lastIndexOf('\nexport { TRIPO_CLIPS };');
  assert.ok(start >= 0 && end > start, 'update VM fixture if renderer boundaries change');
  const context = { THREE: { Vector3, Vector4, Vector2: Vector3, Group: class {},
    MeshStandardMaterial: Material, MeshDepthMaterial: Material, RGBADepthPacking: 3201 },
    NCL: TRIPO_CLIPS.length, KINDS: ['male', 'female', ...TEXTURED], wanted: () => false, COMMON, SKIN_GLSL,
    // (the things characters hold: render/char-props.js, not under test here)
    CharProps: class { begin() {} end() {} push() {} initKind() {} setShadows() {} count() { return 0; } }, shapeFor: () => 0,
    loadKind: () => { throw new Error('rig audit must not load assets'); },
    RIG_BATCHES, RIG_BODIES, normalizeRigSettings, rigBatchForKind,
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (mode === 'reject') throw new Error('fixture unavailable');
      return { ok: mode !== '404', json: async () => structuredClone(saved) };
    }, console };
  vm.runInNewContext(source.slice(start, end).replace('export class Characters', 'class Characters')
    + '\nglobalThis.C = Characters;', context, { filename: 'production-characters.js' });
  const chars = new context.C({ capacity: 0, lods: [] });
  assert.ok(chars.rigReady && typeof chars.rigReady.then === 'function');
  const settings = await chars.rigReady; await chars.ready;
  assert.equal(requests.length, 1); assert.equal(requests[0].url, '/assets/chars/rig.json');
  assert.equal(requests[0].options.cache, 'no-cache');
  return { chars, settings };
}
const passes = [[false, true], [false, false], [true, false]];
function compile(chars, kind, pass = passes[0], manifest = manifests[kind] || {}, textured = true) {
  const material = chars.makeMaterial(kind, { tex: kind, off: [], len: [],
    man: { ...manifest, land: manifest.land || { waist: 0.9, neckY: 1.6 } },
    colorMap: textured ? {} : null, normalMap: {} }, ...pass);
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <emissivemap_fragment>' };
  material.onBeforeCompile(shader);
  return { material, shader, rig: shader.uniforms.uRig };
}

test('profile constants and zero defaults remain independent', () => {
  assert.deepEqual(RIG_BATCHES, ['batch1', 'batch2']); assert.deepEqual(RIG_BODIES, ['male', 'female']);
  assert.equal(RIG_LIMIT, 0.15);
  const a = zeroRig(), b = zeroRig(); assert.deepEqual(a, { width: 0, height: 0, forward: 0 });
  assert.notEqual(a, b); a.width = 0.1; assert.equal(b.width, 0);
});
test('production schema 2 explicitly saves exact selected Batch2 male and legacy aliases', () => {
  assert.equal(WORLD.version, 2);
  assert.deepEqual(WORLD.batches.batch2.male, SELECTED);
  assert.deepEqual(WORLD.batches.batch1, LEGACY);
  for (const body of RIG_BODIES) assert.deepEqual(WORLD[body], LEGACY[body]);
  assert.deepEqual(WORLD.batches.batch2.female, LEGACY.female, 'world new female must not inherit Lab zero');
});
test('legacy normalization keeps both original calibrations without implicit new-body inheritance', () => {
  const saved = normalizeRigSettings(LEGACY);
  for (const body of RIG_BODIES) {
    assert.deepEqual(saved.batches.batch1[body], LEGACY[body]);
    assert.equal(saved[body], saved.batches.batch1[body]);
    assert.deepEqual(saved.batches.batch2[body], zeroRig());
  }
});
test('canonical schema 2 overrides stale aliases and normalizes idempotently', () => {
  const input = { ...WORLD, male: zeroRig(), female: zeroRig() }, saved = normalizeRigSettings(input);
  assert.deepEqual(saved.male, LEGACY.male); assert.deepEqual(saved.female, LEGACY.female);
  assert.deepEqual(normalizeRigSettings(saved), saved);
});
test('normalization handles malformed inputs, numeric legacy values and finite bounds', () => {
  for (const input of [undefined, null, [], 'bad']) {
    const saved = normalizeRigSettings(input);
    for (const { batch, body } of slots) assert.deepEqual(saved.batches[batch][body], zeroRig());
  }
  const saved = normalizeRigSettings({ male: { width: 9, height: -9, forward: NaN },
    female: { width: Infinity, height: '0.026' } });
  assert.deepEqual(saved.male, { width: 0.15, height: -0.15, forward: 0 });
  assert.deepEqual(saved.female, { width: 0, height: 0.026, forward: 0 });
});
test('normalization/update preserve unknown metadata and frozen caller input', () => {
  const input = freeze({ ...structuredClone(WORLD), note: { author: 'fixture' }, batches: {
    ...structuredClone(WORLD.batches), future: { preserve: true },
    batch1: { ...structuredClone(WORLD.batches.batch1), note: 'originals',
      female: { ...LEGACY.female, tag: 'old female' } },
    batch2: { ...structuredClone(WORLD.batches.batch2), note: 'keep',
      male: { ...SELECTED, tag: 'saved male' } } } });
  const before = structuredClone(input), change = freeze(request('batch2', 'male', zeroRig()));
  const saved = updateRigProfile(input, change);
  assert.deepEqual(input, before); assert.deepEqual(change.values, zeroRig());
  assert.deepEqual(saved.note, input.note); assert.deepEqual(saved.batches.future, input.batches.future);
  assert.equal(saved.batches.batch1.note, 'originals'); assert.equal(saved.female.tag, 'old female');
  assert.equal(saved.batches.batch2.note, 'keep'); assert.equal(saved.batches.batch2.male.tag, 'saved male');
});
test('save/reset changes exactly one of four profiles and only Batch1 updates its alias', () => {
  const input = freeze(structuredClone(WORLD));
  for (const target of slots) for (const values of [zeroRig(), { width: 0.1, height: -0.1, forward: 0.05 }]) {
    const saved = updateRigProfile(input, request(target.batch, target.body, values));
    for (const { batch, body } of slots) assert.deepEqual(saved.batches[batch][body],
      batch === target.batch && body === target.body ? values : input.batches[batch][body]);
    for (const body of RIG_BODIES) assert.deepEqual(saved[body],
      target.batch === 'batch1' && body === target.body ? values : input[body]);
  }
});
test('save validates every offset, bounds, target and unknown value keys', () => {
  for (const key of ['width', 'height', 'forward']) {
    for (const bad of [NaN, Infinity, -Infinity, '0.01', null, undefined, true, -0.150001, 0.150001])
      assert.throws(() => updateRigProfile(WORLD, request('batch2', 'male', { ...zeroRig(), [key]: bad })));
    for (const valid of [-0.15, 0.15]) assert.equal(updateRigProfile(WORLD,
      request('batch2', 'male', { ...zeroRig(), [key]: valid })).batches.batch2.male[key], valid);
  }
  for (const invalid of [null, {}, request('batch3', 'male', zeroRig()), request('batch1', 'other', zeroRig()),
    request('batch1', 'male', []), request('batch1', 'male', { width: 0, height: 0 }),
    request('batch1', 'male', { ...zeroRig(), unexpected: 1 })]) assert.throws(() => updateRigProfile(WORLD, invalid));
});
test('all 44 real manifests have 65 bones and classify 24 originals / 20 T-pose additions', () => {
  assert.equal(TEXTURED.length, 44); assert.equal(new Set(TEXTURED).size, 44);
  assert.deepEqual([...CHARACTERS].sort(), [...TEXTURED].sort());
  const counts = { batch1: 0, batch2: 0 };
  for (const kind of TEXTURED) {
    const expected = +kind.slice(1) <= 12 ? 'batch1' : 'batch2', manifest = manifests[kind];
    assert.equal(manifest.bones, 65, kind);
    assert.equal(manifest.rigAdapter?.bindPose === 'T', expected === 'batch2', kind);
    assert.equal(rigBatchForKind(kind, manifest), expected, kind);
    assert.equal(rigBatchForKind(kind), expected, `${kind} ID fallback`); counts[expected]++;
  }
  assert.deepEqual(counts, { batch1: 24, batch2: 20 });
});
test('classification handles generic IDs, boundaries and explicit T metadata robustly', () => {
  for (const kind of ['male', 'female', '', 'custom', 'm00', 'm12', 'f23', 'M13', null, undefined])
    assert.equal(rigBatchForKind(kind), 'batch1', String(kind));
  for (const kind of ['m13', 'm22', 'f13', 'f22']) assert.equal(rigBatchForKind(kind), 'batch2');
  assert.equal(rigBatchForKind('m01', { rigAdapter: { bindPose: 'T' } }), 'batch2');
  assert.equal(rigBatchForKind('custom', { rigAdapter: { bindPose: 'T' } }), 'batch2');
  assert.equal(rigBatchForKind('custom', { rigAdapter: { bindPose: 'A' } }), 'batch1');
  assert.equal(rigBatchForKind('f13', { rigAdapter: { bindPose: 'A' } }), 'batch2');
});
test('actual constructor creates four independent uniforms/vectors and Batch1 aliases', async () => {
  const { chars, settings } = await renderer(); assert.deepEqual(settings, normalizeRigSettings(WORLD));
  const refs = slots.map(({ batch, body }) => chars.rigBatchU[batch][body]);
  assert.equal(new Set(refs).size, 4); assert.equal(new Set(refs.map(ref => ref.value)).size, 4);
  for (const body of RIG_BODIES) assert.equal(chars.rigU[body], chars.rigBatchU.batch1[body]);
  for (const { batch, body } of slots) assert.deepEqual(value(chars.rigBatchU[batch][body]), WORLD.batches[batch][body]);
});
test('actual loadRig supports legacy and missing/network fallback with normalized promise results', async () => {
  for (const [saved, mode] of [[LEGACY, 'ok'], [null, 'ok'], [WORLD, '404'], [WORLD, 'reject']]) {
    const { chars, settings } = await renderer(saved, mode), expected = normalizeRigSettings(mode === 'ok' ? saved : null);
    assert.deepEqual(settings, expected);
    for (const { batch, body } of slots) assert.deepEqual(value(chars.rigBatchU[batch][body]), expected.batches[batch][body]);
  }
});
test('actual mapped/plain/depth callbacks route all 44 models and both generic bodies by live uniform reference', async () => {
  const { chars } = await renderer();
  for (const kind of [...TEXTURED, 'male', 'female']) for (const pass of passes) {
    const batch = rigBatchForKind(kind, manifests[kind]), body = kind[0] === 'f' ? 'female' : 'male';
    assert.equal(compile(chars, kind, pass).rig, chars.rigBatchU[batch][body], `${kind}/${pass}`);
  }
  assert.equal(compile(chars, 'm01', passes[0], { rigAdapter: { bindPose: 'T' } }).rig, chars.rigBatchU.batch2.male);
});
test('every m13-m22 receives exact selected calibration; old bodies and all females stay world-equivalent', async () => {
  const { chars } = await renderer();
  for (const kind of [...TEXTURED, 'male', 'female']) for (const pass of passes) {
    const expected = kind[0] === 'f' ? LEGACY.female : /^m(1[3-9]|2[0-2])$/.test(kind) ? SELECTED : LEGACY.male;
    assert.deepEqual(value(compile(chars, kind, pass).rig), expected, `${kind}/${pass}`);
  }
});
test('a new-male edit changes only precompiled new-male materials in all three passes', async () => {
  const { chars } = await renderer(), refs = TEXTURED.flatMap(kind => passes.map(pass => ({ kind, ...compile(chars, kind, pass) })));
  const changed = { width: 0.04, height: -0.03, forward: 0.02 };
  chars.setRig('male', changed.width, changed.height, changed.forward, 'batch2');
  for (const { kind, rig } of refs) assert.deepEqual(value(rig),
    /^m(1[3-9]|2[0-2])$/.test(kind) ? changed : kind[0] === 'f' ? LEGACY.female : LEGACY.male, kind);
  assert.deepEqual(WORLD.batches.batch2.male, SELECTED);
});
test('default setRig edits Batch1 only; all batch IDs share actual shader source/cache keys per variant', async () => {
  const { chars } = await renderer(); chars.setRig('male', 0.1, -0.1, 0.05);
  assert.deepEqual(value(chars.rigU.male), { width: 0.1, height: -0.1, forward: 0.05 });
  assert.deepEqual(value(chars.rigBatchU.batch2.male), SELECTED);
  const keys = new Set();
  for (const textured of [false, true]) for (const pass of passes) {
    const variants = TEXTURED.map(kind => compile(chars, kind, pass, manifests[kind], textured));
    assert.equal(new Set(variants.map(v => v.material.customProgramCacheKey())).size, 1);
    assert.equal(new Set(variants.map(v => v.shader.vertexShader)).size, 1);
    assert.equal(new Set(variants.map(v => v.shader.fragmentShader)).size, 1);
    keys.add(variants[0].material.customProgramCacheKey());
  }
  assert.equal(keys.size, 6);
});
