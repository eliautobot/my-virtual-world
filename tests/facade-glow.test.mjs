// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../client/js/render/buildings.js', import.meta.url), 'utf8');

test('facade window emission is 60% of the original day/night curve', () => {
  const m = source.match(/float glow = mix\((\d*\.?\d+), (\d*\.?\d+), uNight\) \* (\d*\.?\d+);/);
  assert.ok(m, 'one explicit facade-only scale on the shared window glow');
  const [day, night, scale] = m.slice(1).map(Number);
  assert.equal(day, 0.04);
  assert.equal(night, 1.45);
  assert.equal(scale, 0.6, 'ten percentage points above 50% of the original, not a relative 10% multiplier');
  for (const n of [0, 0.25, 0.5, 0.75, 1]) {
    const original = day + (night - day) * n;
    assert.ok(Math.abs(original * scale / original - 0.6) < 1e-12);
  }
});

test('near panes, blinds and far facade LOD share the same scale while street-light spill is unchanged', () => {
  assert.match(source, /vec3 paneE = lc \* lit \* glow \*/);
  assert.match(source, /paneE = lc \* lit \* glow \* 0\.55/);
  assert.match(source, /vec3 farEmis = vec3\(1\.0, 0\.82, 0\.6\) \* o \* cov \* glow \* 0\.9/);
  assert.match(source, /lampLight\(vWP\) \* uNight \* 0\.7 \*/);
  assert.doesNotMatch(source, /totalEmissiveRadiance \*=/, 'do not dim all material lighting or selection effects');
});
