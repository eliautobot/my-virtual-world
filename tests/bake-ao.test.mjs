// Ambient occlusion baked into characters (tools/chars/bake-ao.mjs, 2026-11-19, the product owner: "the models in-game
// didn't have much lighting/shadows"): a vertex in the open is fully open, one in a crease is closed in by what is round
// it, a near wall more than a far one; the kit carries each vertex's material finish (shared/char-kit.js rm).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBVH, bakeAO } from '../tools/chars/bake-ao.mjs';
import { encodeKit, decodeKit } from '../shared/char-kit.js';

/** A floor (2 × 2 m, at y 0) and, when `wall`, a wall at x = d standing up from it. */
function scene(wall, d = 0.05) {
  const pos = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], idx = [0, 2, 1, 0, 3, 2];
  if (wall) { const b = pos.length / 3; pos.push(d, 0, -1, d, 0, 1, d, 1, 1, d, 1, -1); idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}
const pt = (x, y, z) => ({ pos: new Float32Array([x, y, z]), nrm: new Float32Array([0, 1, 0]), n: 1 });

test('in the open: fully open; beside a wall: closed in; a near wall more than a far one', () => {
  const open = bakeAO(pt(0, 0.001, 0), buildBVH([scene(false)]))[0];
  assert.equal(open, 1, 'nothing round it');
  const near = bakeAO(pt(0, 0.001, 0), buildBVH([scene(true, 0.03)]), { reach: 0.22 })[0];
  const far = bakeAO(pt(0, 0.001, 0), buildBVH([scene(true, 0.18)]), { reach: 0.22 })[0];
  assert.ok(near < 0.8 && near > 0.2, `a wall 3 cm off closes it in (${near.toFixed(2)})`);
  assert.ok(far > near && far < 1, `one 18 cm off less (${far.toFixed(2)})`);
  const only = bakeAO({ pos: new Float32Array([0, 0.001, 0, 0.5, 0.001, 0]), nrm: new Float32Array([0, 1, 0, 0, 1, 0]), n: 2 }, buildBVH([scene(true, 0.03)]), { only: new Uint8Array([0, 1]) });
  assert.equal(only[0], 1, 'a vertex not asked for is left open');
});

test('the kit carries each vertex\'s material finish (roughness, metalness), and a kit without it still reads', () => {
  const part = { name: 'Shoes / leather', role: 'shoes', pos: new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0]), nrm: new Float32Array(9), col: new Uint8Array(12), j: new Uint8Array(12), w: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0]), idx: new Uint32Array([0, 1, 2]) };
  const joints = new Array(65 * 3).fill(0);
  const k = decodeKit(encodeKit({ gender: 'male', joints, parts: [{ ...part, rm: new Uint8Array([135, 0, 135, 0, 40, 148]) }] }));
  assert.deepEqual([...k.parts[0].rm], [135, 0, 135, 0, 40, 148]);
  assert.equal(decodeKit(encodeKit({ gender: 'male', joints, parts: [part] })).parts[0].rm, null);
});

test('the renderer: the characters\' lighting reverted (2026-11-19, the owner) — no occlusion, finish or rim drawn; the packed normal-map flag still read; the close-up level as an option', async () => {
  const fs = await import('node:fs'), vm = await import('node:vm'), { addKindHelpers } = await import('./helpers/char-kinds.mjs');
  const src = fs.readFileSync(new URL('../client/js/render/characters.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /chAO|chRim|uRim|envMapIntensity|roughnessFactor = clamp|metalnessFactor = mod/, 'none of the lighting drawn');
  assert.match(src, /uShade > 0\.5 \? mod\(floor\(vCol\.a \* 255\.0 \+ 0\.5\), 2\.0\) > 0\.5 : vCol\.a > 0\.5/, 'the normal map where the flag is set, packed or not');
  const ctx = addKindHelpers(src, vm.createContext({ KINDS: ['male', 'female'] })), two = k => vm.runInContext(`twoSided(${JSON.stringify(k)})`, ctx);
  assert.ok(two('crowd_m|top|3|c') && two('crowd_f|hair|0|c') && !two('crowd_m|body|0|c') && !two('crowd_f'), 'the close-up level: clothes two-sided, the bare body one-sided');
  const agents = fs.readFileSync(new URL('../client/js/render/agents.js', import.meta.url), 'utf8');
  assert.match(agents, /this\.closePx = v === 'standard' \? 0 : v === 'close' \? q\.pxCloseAsked : q\.pxClose;/, 'Character detail: by the quality (High, Medium), always, or never');
  assert.match(agents, /const L0 = at\(q\.px0\) \*\* 2, L1 = at\(q\.px1\) \*\* 2, L2 = at\(q\.px2\) \*\* 2, L0own = at\(q\.px0Own \?\? q\.px0\) \*\* 2;/, 'each level by the size on the screen');
  const scene = fs.readFileSync(new URL('../client/js/render/scene.js', import.meta.url), 'utf8');
  for (const q of ['low', 'medium', 'high']) assert.match(scene, new RegExp(`${q}: \\{[^}]*px0: [\\d.]+, px1: [\\d.]+, px2: [\\d.]+, pxClose: [\\d.]+, pxCloseAsked: [\\d.]+, px0Own: [\\d.]+ \\}`), q);
  assert.match(agents, /d2 < \(chars\.crowdOf\[i\] === undefined \? L0own : L0\)/, 'a model of their own: its near level to where it was');
  assert.match(scene, /low: \{[^}]*pxClose: 0,/, 'Low: no close-up level unless asked');
  const settings = fs.readFileSync(new URL('../server/settings.js', import.meta.url), 'utf8');
  assert.match(settings, /path: 'display\.charDetail'.*values: \['auto', 'standard', 'close'\]/);
});
