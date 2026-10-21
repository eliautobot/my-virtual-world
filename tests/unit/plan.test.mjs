// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Motion plans: the server builder and evaluator (server/sim/plan.js), the wire format and the client evaluator
// (shared/proto.js). Every client must place every resident exactly where the server planned it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Plan, evalPlan, continuePlan, truncatePlan, safeCutTime } from '../../server/sim/plan.js';
import { encodePlans, decodePlans, evalDecoded, planBytes, F_HIDDEN } from '../../shared/proto.js';
import { normAngle } from '../../shared/geom.js';

const near = (a, b, eps, what = '') => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);
const at = (P, t) => { const e = evalPlan(P, t); return [e.x, e.y, e.z]; };
const nearPt = (got, want, eps, what) => { for (let k = 0; k < 3; k++) near(got[k], want[k], eps, `${what} [${'xyz'[k]}]`); };

function samplePlan() {
  const P = new Plan(100, { x: 0, y: 0.15, z: 0, ctx: -1, yaw: 0 });
  P.move(10, 0.15, 0, 2, 1, 0);                           // 100-105 walk east
  P.hold(3, 0, 0);                                         // 105-108 wait
  P.move(10, 0.15, 8, 1, 1, 0);                            // 108-116 walk south
  P.seg(4, 10, 3.55, 8, 0, 0, 0, 0, F_HIDDEN, 5);          // 116-120 elevator ride, hidden, floor context 5
  P.move(12, 3.55, 8, 1, 1, 0, { ctx: 5 });                // 120-122 walk out of the elevator
  return P;
}

test('a plan is evaluated piecewise-linearly in absolute sim time', () => {
  const P = samplePlan();
  assert.equal(P.t, 122);
  nearPt(at(P, 50), [0, 0.15, 0], 1e-12, 'before the start');
  nearPt(at(P, 102.5), [5, 0.15, 0], 1e-12, 'half way along the first walk');
  nearPt(at(P, 105), [10, 0.15, 0], 1e-12, 'segment boundary');
  nearPt(at(P, 106), [10, 0.15, 0], 1e-12, 'holding');
  nearPt(at(P, 112), [10, 0.15, 4], 1e-12, 'second walk');
  nearPt(at(P, 118), [10, 1.85, 8], 1e-12, 'in the elevator');
  nearPt(at(P, 1000), [12, 3.55, 8], 1e-12, 'after the end');
  assert.equal(evalPlan(P, 118).ctx, 5);
  near(P.segs[0].yaw, Math.PI / 2, 1e-12, 'walking east faces +x');
});

test('continuePlan keeps every segment still running, so the hand-over is seamless', () => {
  const P = samplePlan();
  const C = continuePlan(P, 109);
  assert.equal(C.base, 108);
  assert.equal(C.segs.length, 3);
  assert.equal(C.t, P.t);
  for (let t = 108; t <= 125; t += 0.25) nearPt(at(C, t), at(P, t), 1e-9, `t ${t}`);
});

test('truncatePlan cuts a plan mid-segment', () => {
  const P = samplePlan();
  assert.equal(truncatePlan(P, 112), null, 'not seated, nothing to stand up from');
  assert.equal(P.t, 112);
  assert.equal(P.segs.length, 3);
  nearPt(at(P, 500), [10, 0.15, 4], 1e-12, 'ends where it was cut');
});

test('safeCutTime never interrupts a crossing or a hidden elevator ride', () => {
  const P = new Plan(0, { x: 0, y: 0, z: 0, ctx: -1 });
  P.move(4, 0, 0, 1, 1, 0);                                  // 0-4 walk
  P.seg(3, 4, 0, 3, 0, 1, 0, 0, 0, -1, { cross: 1 });       // 4-7 crosswalk
  P.seg(3, 4, 0, 6, 0, 1, 0, 0, 0, -1, { cross: 1 });       // 7-10 crosswalk
  P.hold(5, 0, 0);                                           // 10-15
  P.seg(2, 4, 3.4, 6, 0, 0, 0, 0, F_HIDDEN, 3);              // 15-17 elevator
  P.hold(5, 0, 0);                                           // 17-22
  assert.equal(safeCutTime(P, 2), 2);
  assert.equal(safeCutTime(P, 5), 10);
  assert.equal(safeCutTime(P, 12), 12);
  assert.equal(safeCutTime(P, 15.5), 17);
  assert.equal(safeCutTime(P, 30), 30);
});

test('plans survive the wire format', () => {
  const P = samplePlan();
  P.meta.dest = 5;
  const Q = new Plan(50, { x: -3, y: 0.15, z: 7, ctx: -1 });
  Q.hold(2, 0, 0);
  Q.move(-3, 0.15, 12, 1.4, 1, 3, { prop: 2 });
  Q.segs[1].yaw = 3.5;
  const buf = encodePlans([[7, P], [3, Q]]);
  assert.equal(buf.byteLength, 4 + planBytes(P.segs.length) + planBytes(Q.segs.length));
  const got = new Map();
  assert.equal(decodePlans(buf, (i, p) => got.set(i, p)), 2);
  const d = got.get(7);
  assert.equal(d.n, P.segs.length);
  assert.equal(d.base, 100);
  assert.equal(d.dest, 5);
  near(d.end, P.t, 1e-4, 'end time');
  P.segs.forEach((s, k) => {
    near(d.x[k], s.x, 1e-5, `x ${k}`); near(d.y[k], s.y, 1e-5, `y ${k}`); near(d.z[k], s.z, 1e-5, `z ${k}`);
    assert.equal(d.ctx[k], s.ctx); assert.equal(d.anim[k], s.anim); assert.equal(d.use[k], s.use); assert.equal(d.flags[k], s.flags);
  });
  const q = got.get(3);
  assert.equal(q.dest, -1);
  assert.equal(q.prop[1], 2);
  assert.equal(q.use[1], 3);
  near(q.yaw[1], normAngle(3.5), 1e-4, 'yaw is normalised');
});

test('a client evaluates a decoded plan exactly like the server', () => {
  const P = samplePlan();
  let dec;
  decodePlans(encodePlans([[0, P]]), (i, p) => { dec = p; });
  for (let t = 95; t <= 127; t += 0.01) {
    const a = evalPlan(P, t), b = evalDecoded(dec, t);
    near(b.x, a.x, 1e-4, `x at ${t}`); near(b.y, a.y, 1e-4, `y at ${t}`); near(b.z, a.z, 1e-4, `z at ${t}`);
  }
});
