// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The flight model flown by a script (shared/flight-model.js): each plane takes off within a sensible run, climbs, cruises
// near its cruise speed, turns when banked, stalls when slowed, lands gently and crashes when it should; the helicopter
// spins up, lifts off, hovers, flies, lands on a roof and crashes into a wall or a hard landing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { newFlight, stepFlight, anglesOf, instruments, fromAngles } from '../shared/flight-model.js';
import { AIRCRAFT } from '../shared/aircraft-specs.js';

const flat = { ground: () => 0, water: () => null, solid: () => null };
const DT = 1 / 120;
function fly(s, seconds, input, env = flat) { for (let t = 0; t < seconds && !s.crashed; t += DT) stepFlight(s, typeof input === 'function' ? input(s) : input, env, DT); return s; }
/** A pilot: full power, rotate at rotation speed, then hold a climb attitude (pitch ≈ target). */
const climbOut = (target = 0.12) => s => {
  const S = AIRCRAFT[s.type], i = instruments(s), a = anglesOf(s.q);
  return { throttle: 1, pitch: i.speed > S.rotate ? Math.max(-1, Math.min(1, (target - a.pitch) * 4)) : 0, roll: Math.max(-1, Math.min(1, -a.bank * 2)) };
};

for (const type of ['prop', 'jet']) {
  test(`${type}: takes off within a sensible run, climbs out, cruises near its cruise speed`, () => {
    const S = AIRCRAFT[type], s = newFlight(type, 0, 0, 0, 0);
    let liftoff = null;
    for (let t = 0; t < 120 && !s.crashed; t += DT) { stepFlight(s, climbOut()(s), flat, DT); if (!liftoff && !s.onGround && s.agl > 1) liftoff = s.p.z; }
    assert.equal(s.crashed, null);
    assert.ok(liftoff > 30 && liftoff < S.takeoffRun * 1.6, `${type} left the ground after ${liftoff?.toFixed(0)} m`);
    assert.ok(s.p.y > 150, `${type} climbed to ${s.p.y.toFixed(0)} m in two minutes`);
    // level off at reduced power: the speed settles near the cruise speed
    const level = st => { const a = anglesOf(st.q); return { throttle: instruments(st).speed > S.cruise ? -1 : 1, pitch: Math.max(-1, Math.min(1, (0.02 - a.pitch) * 3 - st.v.y * 0.05)), roll: -a.bank * 2 }; };
    fly(s, 60, level);
    const i = instruments(s);
    assert.equal(s.crashed, null);
    assert.ok(Math.abs(i.speed - S.cruise) < S.cruise * 0.2, `${type} cruises at ${i.speed.toFixed(0)} m/s (cruise ${S.cruise})`);
    assert.ok(Math.abs(i.vs) < 4, `level: ${i.vs.toFixed(1)} m/s vertical`);
    // bank right: the heading turns right (it decreases: the nose along (sin h, cos h))
    const h0 = anglesOf(s.q).heading;
    fly(s, 6, st => { const a = anglesOf(st.q); return { throttle: 0.2, pitch: (0.05 - a.pitch) * 3, roll: Math.max(-1, Math.min(1, (0.5 - a.bank) * 3)) }; });
    const turned = anglesOf(s.q).heading - h0;
    assert.ok(turned < -0.22, `banked right, it turned right by ${(-turned * 180 / Math.PI).toFixed(0)}°`);
  });
}

test('prop: power off and nose up, it stalls; a gentle approach lands; a dive into the ground crashes', () => {
  const s = newFlight('prop', 0, 0, 0, 0);
  s.onGround = false; s.p.y = 300; s.v = { x: 0, y: 0, z: 45 }; s.engine = s.throttle = 0.4;
  fly(s, 12, st => ({ throttle: -1, pitch: 1, roll: 0 }));
  assert.ok(s.stall || instruments(s).speed < 25, 'stalls');
  // a gentle approach: 40 m/s, 2 m/s down, wings level, flare
  const l = newFlight('prop', 0, 0, 0, 0);
  l.onGround = false; l.p.y = 40; l.q = fromAngles(0, 0.03, 0); l.v = { x: 0, y: -2, z: 32 }; l.engine = l.throttle = 0.25;
  fly(l, 60, st => { const a = anglesOf(st.q), sp = instruments(st).speed;   // hold 30 m/s with power and 2 m/s down with the nose; flare near the ground
    if (st.onGround) return { throttle: -1, brake: true, roll: 0 };
    if (st.agl < 4) return { throttle: -1, pitch: Math.max(-1, Math.min(1, (0.1 - a.pitch) * 4)), roll: -a.bank * 2 };
    return { throttle: Math.max(-1, Math.min(1, (30 - sp) * 0.3)), pitch: Math.max(-1, Math.min(1, (-2 - st.v.y) * 0.25)), roll: -a.bank * 2 }; });
  assert.equal(l.crashed, null, l.crashed);
  assert.equal(l.onGround, true); assert.ok(instruments(l).speed < 3, 'rolled to a stop');
  const d = newFlight('prop', 0, 0, 0, 0);
  d.onGround = false; d.p.y = 60; d.q = fromAngles(0, -0.6, 0); d.v = { x: 0, y: -30, z: 40 };
  fly(d, 10, { throttle: 1 });
  assert.match(d.crashed || '', /hard a landing|Nose first/);
});

test('planes crash into walls and water', () => {
  const wall = { ...flat, solid: (x, y, z) => (z > 100 && z < 120 && y < 40 ? 'the terminal' : null) };
  const s = newFlight('prop', 0, 0, 0, 0); s.onGround = false; s.p.y = 20; s.v = { x: 0, y: 0, z: 45 }; s.engine = s.throttle = 0.6;
  fly(s, 5, { throttle: 0 }, wall);
  assert.equal(s.crashed, 'You hit the terminal');
  const sea = { ground: () => -6, water: () => -2.4, solid: () => null };
  const w = newFlight('prop', 0, 0, 0, 0); w.onGround = false; w.p.y = 5; w.v = { x: 0, y: -3, z: 40 };
  fly(w, 10, { throttle: 0, pitch: -0.3 }, sea);
  assert.match(w.crashed || '', /water/);
});

test('helicopter: spins up, lifts, hovers, flies forward, turns, lands on a roof; a hard landing crashes', () => {
  const roofEnv = { ground: (x, z) => (Math.abs(x) < 20 && z > 380 && z < 420 ? 30 : 0), water: () => null, solid: (x, y, z) => (Math.abs(x) < 20 && z > 380 && z < 420 && y < 30 ? 'a building' : null) };
  const s = newFlight('heli', 0, 0, 0, 0);
  fly(s, 2, { throttle: 1 }, roofEnv);
  assert.equal(s.onGround, true, 'no lift before the rotor is up to speed');
  fly(s, 6, { throttle: 1 }, roofEnv);
  assert.ok(s.p.y > 20, `climbed to ${s.p.y.toFixed(1)} m`);
  fly(s, 3, {}, roofEnv); const y0 = s.p.y; fly(s, 4, {}, roofEnv);
  assert.ok(Math.abs(s.p.y - y0) < 2 && Math.hypot(s.v.x, s.v.z) < 1, 'hovers with nothing held');
  fly(s, 3, { throttle: 1 }, roofEnv);   // over the roof's height
  fly(s, 12, st => ({ pitch: st.p.z < 360 ? -1 : 0.6 }), roofEnv);   // nose down to go forward, then back to slow
  assert.ok(s.p.z > 200, `flew forward ${s.p.z.toFixed(0)} m`);
  fly(s, 60, st => { const h = Math.hypot(st.v.x, st.v.z), over = st.p.z > 388 && st.p.z < 412;   // slow down over the roof, then let down
    return { pitch: Math.max(-1, Math.min(1, ((400 - st.p.z) * 0.08 - st.v.z) * -0.3)), throttle: over && h < 2 ? -0.35 : 0 }; }, roofEnv);
  assert.equal(s.crashed, null, s.crashed);
  assert.equal(s.onGround, true, 'landed on the roof'); assert.ok(Math.abs(s.p.y - 30 - AIRCRAFT.heli.gearH) < 0.05);
  const h0 = anglesOf(s.q).heading; fly(s, 3, { throttle: 1 }, roofEnv); fly(s, 2, { yaw: 1 }, roofEnv);
  assert.ok(anglesOf(s.q).heading < h0 - 0.5, 'the pedals turn it');
  const hard = newFlight('heli', 0, 0, 0, 0); hard.rpm = 1; hard.onGround = false; hard.p.y = 7; hard.v = { x: 0, y: -12, z: 0 };
  fly(hard, 12, { throttle: -1 });
  assert.match(hard.crashed || '', /hard a landing/);
});

test('a plane flown level into a hillside crashes (not a landing); so does a landing far too fast; a slope rolls', () => {
  const hill = { ground: (x, z) => (z > 200 ? (z - 200) * 0.5 : 0), water: () => null, solid: () => null };
  const s = newFlight('jet', 0, 0, 0, 0); s.onGround = false; s.p.y = 25; s.q = fromAngles(0, 0.03, 0); s.v = { x: 0, y: 0, z: 110 }; s.engine = s.throttle = 0.8;
  fly(s, 6, {}, hill);
  assert.equal(s.crashed, 'You flew into the hillside');
  const f = newFlight('jet', 0, 0, 0, 0); f.onGround = false; f.p.y = AIRCRAFT.jet.gearH + 0.01; f.q = fromAngles(0, 0.02, 0); f.v = { x: 0, y: -1.5, z: 120 }; f.engine = f.throttle = 0.5;
  fly(f, 2, {});
  assert.match(f.crashed || '', /Far too fast to land/);
  // taxiing up a gentle slope (10%) at 20 m/s is no crash
  const ramp = { ground: (x, z) => (z > 50 ? (z - 50) * 0.1 : 0), water: () => null, solid: () => null };
  const t = newFlight('prop', 0, 0, 0, 0); t.v = { x: 0, y: 0, z: 20 }; t.engine = t.throttle = 0.3;
  fly(t, 6, { throttle: 0 }, ramp);
  assert.equal(t.crashed, null, t.crashed); assert.ok(t.p.z > 80, 'rolled on up the slope');
});

const deg = r => (r * 180 / Math.PI).toFixed(0);
test('the helicopter sways: the nose dips setting off and swings back, hands off it flares into a hover, at speed it banks into a turn and carves', () => {
  const s = newFlight('heli', 0, 0, 0, 0); fly(s, 6, { throttle: 1 }); fly(s, 3, {});
  let minP = 0; for (let t = 0; t < 1.5; t += DT) { stepFlight(s, { pitch: -1 }, flat, DT); minP = Math.min(minP, anglesOf(s.q).pitch); }
  fly(s, 1.5, { pitch: -1 }); const settled = anglesOf(s.q).pitch;
  assert.ok(minP < settled - 0.04, `the nose dips past (${deg(minP)}°) and swings back (${deg(settled)}°)`);
  fly(s, 4, { pitch: -1 });
  const v0 = instruments(s).speed; let maxP = -1, stop = null;
  for (let t = 0; t < 15; t += DT) { stepFlight(s, {}, flat, DT); maxP = Math.max(maxP, anglesOf(s.q).pitch); if (stop == null && instruments(s).speed < 1) stop = t; }
  assert.ok(maxP > 0.15, `hands off it flares: the nose up ${deg(maxP)}°`);
  assert.ok(stop != null && stop < 12, `from ${v0.toFixed(0)} m/s to a hover in ${stop?.toFixed(1)} s`);
  assert.ok(Math.abs(anglesOf(s.q).pitch) < 0.03 && Math.abs(anglesOf(s.q).bank) < 0.03, 'and it levels');
  fly(s, 6, { pitch: -1 }); const h0 = anglesOf(s.q).heading;
  fly(s, 6, { pitch: -1, yaw: 1 });
  const a = anglesOf(s.q); let slip = Math.atan2(s.v.x, s.v.z) - a.heading; slip -= Math.round(slip / (2 * Math.PI)) * 2 * Math.PI;
  assert.ok(a.bank > 0.35, `turning right at speed it banks right: ${deg(a.bank)}°`);
  assert.ok(Math.abs(slip) < 0.12, `and carves: the way it goes turns with the nose (${deg(slip)}° apart)`);
  assert.ok(h0 - a.heading > 1, `turned ${deg(h0 - a.heading)}° in 6 s`);
  assert.equal(s.crashed, null);
});

test('the feel: a tap is a small change, hands off holds (wings, a bank, the height in a turn), the stick is proportional', () => {
  const cruise = () => { const s = newFlight('prop', 0, 0, 0, 0); s.onGround = false; s.p.y = 400; s.v = { x: 0, y: 0, z: 50 }; s.q = fromAngles(0, 0.02, 0); s.engine = s.throttle = 0.55; return s; };
  // hands off at cruise power: it flies on level (no drift, no porpoising)
  let s = cruise(); fly(s, 3, {}); const y0 = s.p.y; fly(s, 20, {});
  assert.ok(Math.abs(s.p.y - y0) < 25, `hands off: ${(s.p.y - y0).toFixed(1)} m in 20 s`);
  assert.ok(Math.abs(anglesOf(s.q).bank) < 0.02, 'wings level');
  // a tap on the roll key (0.15 s): a small bank, which levels itself again
  s = cruise(); fly(s, 0.15, { roll: 1 }); fly(s, 0.4, {});
  const tap = anglesOf(s.q).bank * 180 / Math.PI;
  assert.ok(tap > 0.5 && tap < 9, `a tap banks it ${tap.toFixed(1)}°`);
  fly(s, 4, {}); assert.ok(Math.abs(anglesOf(s.q).bank) < 0.03, 'and it levels itself (a shallow bank)');
  // held: into a 30° bank, let go: the bank holds and so does the height (the trim pulls for the turn)
  s = cruise(); fly(s, 3, {});
  for (let t = 0; t < 4 && anglesOf(s.q).bank < 0.52; t += DT) stepFlight(s, { roll: 1 }, flat, DT);
  const b0 = anglesOf(s.q).bank, h0 = s.p.y; fly(s, 10, {});
  assert.ok(Math.abs(anglesOf(s.q).bank - b0) < 0.07, `the bank holds: ${(b0 * 57.3).toFixed(0)}° → ${(anglesOf(s.q).bank * 57.3).toFixed(0)}°`);
  assert.ok(Math.abs(s.p.y - h0) < 30, `the height holds in the turn: ${(s.p.y - h0).toFixed(1)} m in 10 s`);
  // the stick is proportional: a third of the stick rolls it far less than full stick
  const roll = x => { const t = cruise(); fly(t, 1, { roll: x }); return anglesOf(t.q).bank; };
  assert.ok(roll(0.33) < roll(1) * 0.3, `a third of the stick: ${(roll(0.33) * 57.3).toFixed(1)}° against ${(roll(1) * 57.3).toFixed(1)}° in a second`);
  // never past the bank limit, however long it is held
  s = cruise(); fly(s, 6, { roll: 1 }); assert.ok(anglesOf(s.q).bank < AIRCRAFT.prop.maxBank + 0.08, `held, it stops at ${(anglesOf(s.q).bank * 57.3).toFixed(0)}°`);
});
