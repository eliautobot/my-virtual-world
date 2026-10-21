// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The loading screen's art (client/js/loading-art.js): every figure, at any moment, samples into the same number of
// particles at real places on its stage, and any figure can transform into any other (each particle has exactly one place
// to go). The file is a classic script (a worker's and a page's), so it is run here in a bare context.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = { performance, Math, Float32Array, Float64Array, Int32Array, Array, Object, Number };
ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../../client/js/loading-art.js', import.meta.url), 'utf8'), ctx);
const { figures, allocate, place, match, K, FW, FH } = ctx.MVWLoadingArt;
const STEPS = ['account', 'city', 'streets', 'buildings', 'furnish', 'residents', 'waking', 'lighting', 'signin', 'error'];
const sample = (id, t, T) => {
  const s = figures[id](t, T), l = allocate(s), x = new Float32Array(K), y = new Float32Array(K);
  place(s, l, x, y);
  return { s, l, x, y };
};

test('every step of loading has its figure', () => {
  for (const id of STEPS) assert.equal(typeof figures[id], 'function', id);
});

test('a figure samples into exactly K particles at finite places near its stage, at every moment of its motion', () => {
  for (const id of STEPS) for (const t of [0, 0.3, 0.9, 1.6, 4, 37.7]) {
    const { s, l, x, y } = sample(id, t, t + 11.3);
    assert.equal(l.total, K, `${id} at ${t}: ${l.total} particles`);
    assert.ok(s.length > 0 && s.every(st => st.pts.length > 0), `${id} has strokes`);
    for (let i = 0; i < K; i++) {
      assert.ok(Number.isFinite(x[i]) && Number.isFinite(y[i]), `${id} at ${t}: particle ${i} is ${x[i]}, ${y[i]}`);
      assert.ok(x[i] > -FW * 0.25 && x[i] < FW * 1.25 && y[i] > -FH * 0.4 && y[i] < FH * 1.25, `${id} at ${t}: particle ${i} far off stage (${x[i]}, ${y[i]})`);
    }
  }
});

test('the stroke structure of a figure does not change as it moves (a transformation keeps its particle layout)', () => {
  for (const id of STEPS) {
    const a = figures[id](0.1, 3), b = figures[id](2.5, 9.7);
    assert.equal(a.length, b.length, `${id}: stroke count`);
    a.forEach((st, i) => assert.equal(st.pts.length, b[i].pts.length, `${id}: stroke ${i} vertices`));
  }
});

test('short polylines keep their corners exactly (a rectangle stays a rectangle when sampled)', () => {
  const { s, l, x, y } = sample('furnish', 2, 2);
  s.forEach((st, si) => {
    if (st.dot || st.pts.length > 10 || l.cnt[si] < st.pts.length) return;
    for (const [px, py] of st.pts) {
      let best = Infinity;
      for (let k = l.ranges[si]; k < l.ranges[si] + l.cnt[si]; k++) best = Math.min(best, Math.hypot(x[k] - px, y[k] - py));
      assert.ok(best < 1e-3, `corner (${px}, ${py}) of stroke ${si} missed by ${best}`);
    }
  });
});

test('any figure transforms into any other: every particle gets exactly one place in the next figure, close by', () => {
  for (const a of STEPS) for (const b of STEPS) {
    if (a === b) continue;
    const A = sample(a, 2, 5), B = sample(b, 0, 5), perm = match(A.x, A.y, B.x, B.y);
    const seen = new Set(perm);
    assert.equal(seen.size, K, `${a} → ${b}: a one-to-one mapping`);
    let d = 0, d0 = 0;
    for (let i = 0; i < K; i++) { d += Math.hypot(A.x[i] - B.x[perm[i]], A.y[i] - B.y[perm[i]]); d0 += Math.hypot(A.x[i] - B.x[i], A.y[i] - B.y[i]); }
    assert.ok(d <= d0, `${a} → ${b}: matched trips (${(d / K).toFixed(1)}) are no longer than unmatched ones (${(d0 / K).toFixed(1)})`);
  }
});
