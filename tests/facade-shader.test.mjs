// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The real-browser UI gate additionally rasterizes the actual facade seed expressions (facadecheck.cjs).
// These contracts prevent accidentally restoring smooth interpolation to metadata while retaining continuous UVs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../client/js/render/buildings.js', import.meta.url), 'utf8');
const shader = name => {
  const m = source.match(new RegExp(`const ${name} = \\x60([^\\x60]+)\\x60;`));
  assert.ok(m, `${name} declarations exist`);
  return m[1];
};
const metadata = { vB: 'float', vK: 'float', vS: 'vec4', vSize: 'vec2', vDoor: 'vec3', vWC: 'vec3', vGC: 'vec3', vTC: 'vec3' };

test('every per-face facade value uses matching WebGL2 flat vertex and fragment varyings', () => {
  for (const name of ['FAC_VERT', 'FAC_FRAG']) {
    const s = shader(name);
    for (const [v, type] of Object.entries(metadata)) {
      assert.match(s, new RegExp(`\\bflat varying ${type} ${v};`), `${name}: ${v} must not be perspective-interpolated`);
      assert.equal([...s.matchAll(new RegExp(`\\b${type} ${v};`, 'g'))].length, 1, `${name}: one declaration of ${v}`);
    }
  }
});

test('facade coordinates and world position stay interpolated; dimensions do not', () => {
  assert.match(shader('FAC_VERT'), /(?:^|;)\s*varying vec2 vF;/);
  assert.match(shader('FAC_FRAG'), /(?:^|;)\s*varying vec2 vF;/);
  assert.match(shader('FAC_VERT'), /(?:^|;)\s*varying vec3 vWP;/);
  assert.match(source, /vF = aF\.xy; vSize = aF\.zw;/);
  assert.match(source, /W = vSize\.x;/);
  assert.match(source, /fl < vSize\.y - 0\.5/);
  assert.doesNotMatch(source, /vF\.[zw]/, 'width/storey count cannot come from interpolated facade UVs');
});

test('window seeds still depend on exact building/face identities, without changing the hash or pane layout', () => {
  assert.match(source, /wid = h21\(vec2\(vB \* 1\.37 \+ vK \* 5\.1 \+ ci \* 0\.73, fl \* 1\.91 \+ 0\.5\)\);/);
  assert.match(source, /float fh = h21\(vec2\(vB \* 3\.1 \+ vK \* 0\.3, fl \+ 11\.0\)\);/);
  for (const [a, v] of [['aB', 'vB'], ['aK', 'vK'], ['aS', 'vS'], ['aDoor', 'vDoor']]) {
    assert.ok(source.includes(`${v} = ${a};`), `${a} reaches its exact flat varying`);
  }
  assert.match(source, /aF: \[v === 1 \|\| v === 2 \? W : 0, v < 2 \? y0 : y1, W, B\.floors\]/,
    'quad corners retain the continuous coordinates and identical face dimensions');
});
