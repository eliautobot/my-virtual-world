// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../client/js/render/scene.js', import.meta.url), 'utf8');
const windows = fs.readFileSync(new URL('../client/js/render/buildings.js', import.meta.url), 'utf8');

test('global bloom strength smoothly spans 0.10 by day to 0.40 at full night', () => {
  const m = source.match(/this\.bloom\.strength = ([\d.]+) \+ ([\d.]+) \* night;/);
  assert.ok(m, 'one day/night bloom-strength curve');
  const [day, rise] = m.slice(1).map(Number);
  assert.equal(day, 0.10); assert.equal(rise, 0.30);
  for (const [night, expected] of [[0, 0.10], [0.25, 0.175], [0.5, 0.25], [0.75, 0.325], [1, 0.40]]) {
    assert.ok(Math.abs(day + rise * night - expected) < 1e-12);
  }
});

test('bloom radius is 0.40 and both initial and runtime thresholds are unchanged', () => {
  const m = source.match(/new UnrealBloomPass\(new THREE\.Vector2\(w \/ 2, h \/ 2\), ([\d.]+), ([\d.]+), ([\d.]+)\)/);
  assert.ok(m); const [strength, radius, initialThreshold] = m.slice(1).map(Number);
  assert.equal(strength, 0.10); assert.equal(radius, 0.40); assert.equal(initialThreshold, 0.88);
  assert.match(source, /this\.bloom\.threshold = night > 0\.5 \? 0\.78 : 0\.9;/);
});

test('the transition width, quality policy and 60%-of-original window emission are retained', () => {
  const pass = fs.readFileSync(new URL('../node_modules/three/examples/jsm/postprocessing/UnrealBloomPass.js', import.meta.url), 'utf8');
  assert.match(pass, /this\.highPassUniforms\[ 'smoothWidth' \]\.value = 0\.01;/);
  for (const name of ['low', 'medium']) assert.match(source, new RegExp(`${name}: \\{[^\\n]*bloom: false`));
  assert.match(source, /high: \{[^\n]*bloom: true/);
  assert.match(windows, /float glow = mix\(0\.04, 1\.45, uNight\) \* 0\.6;/);
});
