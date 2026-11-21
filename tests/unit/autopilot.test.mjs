// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An AI agent at the controls (shared/autopilot.js): the airport's ring courses flown by an autopilot that only moves the
// controls of the same flight model a person flies — taxi out, take off, the rings, the landing, back to the stand — its
// sampled path judged by the module's own run check (shared/airport.js verifyFlight) for every class of aircraft; never a
// path the check calls too fast or malformed; a better pilot (its airport level) faster; the Dubins way-finder it plans with.
import assert from 'node:assert/strict';
import test from 'node:test';
import { COURSES, COURSE_BY_ID, courseRings, ringPasses, verifyFlight } from '../../shared/airport.js';
import { AutoFlight, dubins } from '../../shared/autopilot.js';
import { standsAt } from '../../shared/airport-layout.js';
import { AIRCRAFT, maxRunSpeed } from '../../shared/aircraft-specs.js';

const M = { id: 'wm1', x: 500, z: -300, y: 12, rot: 0.7 };
const flat = { ground: () => M.y, water: () => null, solid: () => null };
/** Flies course c from airport m (flat land) to the end: { f (the flight), rings, res (the run check of its report), at (s) }. */
function fly(c, { skill = 0.5, m = M, env = flat, clearAt = () => m.y } = {}) {
  const rings = courseRings(c, { x: m.x, z: m.z, y: m.y, yaw: m.rot }, clearAt), stand = standsAt(m).find(s => s.type === c.aircraft);
  const f = new AutoFlight(c.aircraft, { rings, airport: m, stand, clearAt, skill, y: m.y });
  let rep = null;
  while (!f.done && f.t < 1500) { f.step(0.25, env); if (f.through && !rep) rep = { at: f.t, report: f.report() }; }
  // (reported the moment it is through: the run's clock then, as the server's)
  const res = rep ? verifyFlight(c, rep.report, { serverMs: rep.at * 1000 + 300, data: { rings } }) : null;
  return { f, rings, stand, res, rep };
}

for (const id of ['first-flight', 'hover-hop', 'jet-intro']) {
  test(`${id} (${COURSE_BY_ID[id].aircraft}): flown on the flight model, judged by the module's own check, landed back on its stand`, () => {
    const c = COURSE_BY_ID[id], { f, rings, stand, res, rep } = fly(c);
    assert.ok(rep, `through every ring (${f.passes.length} of ${rings.length})`);
    assert.equal(res.ok, true, res.why);
    assert.ok(res.score > 0 && res.score <= c.limit, `in time: ${res.score} s (limit ${c.limit})`);
    assert.equal(ringPasses(rings, rep.report.path).length, rings.length, 'the passes it counted are the ones the check finds');
    // every step of its path within what that aircraft flies (the check's own limit), four samples a second
    const P = rep.report.path, vmax = maxRunSpeed(c.aircraft);
    for (let k = 1; k < P.length; k++) {
      const dt = (P[k][0] - P[k - 1][0]) / 1000;
      assert.ok(dt > 0 && dt <= 0.3, 'sampled four times a second');
      assert.ok(Math.hypot(P[k][1] - P[k - 1][1], P[k][2] - P[k - 1][2], P[k][3] - P[k - 1][3]) <= AIRCRAFT[c.aircraft].max * 1.3 * dt + 0.05 && vmax > AIRCRAFT[c.aircraft].max, 'never faster than the airframe');
    }
    // home: landed, stopped, near its stand (the fleet puts it back on it), no crash
    assert.equal(f.crashed, null);
    assert.equal(f.phase, 'done');
    assert.equal(f.s.onGround, true);
    assert.ok(Math.hypot(f.s.p.x - stand.x, f.s.p.z - stand.z) < 30, `back by its stand (${Math.hypot(f.s.p.x - stand.x, f.s.p.z - stand.z).toFixed(0)} m)`);
    if (c.aircraft !== 'heli') assert.ok(f.ap.final, 'a plane came in on a final approach to the runway');
  });
}

test('every course: a path the check accepts as flown (never too fast, never malformed), most of them in time; no crash on open land', () => {
  const seen = [];
  for (const c of COURSES) {
    const { f, res } = fly(c);
    assert.equal(f.crashed, null, `${c.id}: no crash`);
    if (res) assert.ok(res.ok || /Out of time/.test(res.why), `${c.id}: ${res.why}`);
    seen.push(`${c.id}:${res?.ok ? res.score : res?.why || `${f.passes.length} rings`}`);
    if (res?.ok) assert.ok(res.score <= c.limit);
  }
  const ok = seen.filter(x => /:\d/.test(x)).length;
  assert.ok(ok >= 8, `courses flown in time: ${ok} of ${COURSES.length} — ${seen.join(', ')}`);
});

test('a better pilot (a higher airport level) flies faster; the airport\'s heading changes nothing', () => {
  const c = COURSE_BY_ID['first-flight'];
  const novice = fly(c, { skill: 0 }).res, ace = fly(c, { skill: 1 }).res;
  assert.ok(novice.ok && ace.ok);
  assert.ok(ace.score < novice.score, `the ace ${ace.score} s, the novice ${novice.score} s`);
  const turned = fly(c, { m: { ...M, rot: 3.9 } }).res, here = fly(c).res;
  assert.ok(turned.ok && Math.abs(turned.score - here.score) < 5, `the same course anywhere: ${turned.score} s and ${here.score} s`);
});

test('the Dubins way-finder: from any pose to any pose with the turns a plane can make', () => {
  let k = 0;
  const r = n => { k = (k * 9301 + 49297) % 233280; return (k / 233280) * n; };
  for (let j = 0; j < 400; j++) {
    const w = dubins(r(1000), r(1000), r(6.28) - 3.14, r(1000), r(1000), r(6.28) - 3.14, 50 + r(150));
    assert.ok(w && Number.isFinite(w.len) && w.len > 0, 'a way found');
  }
  const ahead = dubins(0, 0, 0, 0, 500, 0, 100);
  assert.equal(ahead.first, 'S'); assert.ok(Math.abs(ahead.len - 500) < 1e-6, 'straight on: a straight');
  const left = dubins(0, 0, 0, 300, 300, Math.PI / 2, 100);   // (toward +x: a left turn in this world's headings)
  assert.equal(left.first, 'L');
});
