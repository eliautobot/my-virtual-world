// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The flight model (docs/features/play-modules.md §Airport): how the airport's aircraft fly, in the pilot's own browser
// (like a car, decision A20; the server checks the poses and the ring runs). Pure maths, no three.js: the browser steps
// it every frame and the tests fly it. Metres, seconds, radians; world y up; the aircraft's own frame: nose +z, up +y,
// left wing +x (render/aircraft-models.js).
//
// PLANES (the propeller plane, the small jet): lift from the wing grows with the square of the airspeed and with the
// angle of attack until the wing stalls (beyond ≈15° it falls away: the nose drops); drag is parasitic (grows with the
// square of the speed: the top speed is where it meets full thrust) plus induced (lift costs drag: slow, high-angle
// flight sinks); the engine spools up; the controls work by the airflow over them (nothing at a standstill, full at
// rotation speed); a banked plane turns (coordinated: the nose follows the turn), a level one flies straight, the nose
// weathervanes into the airflow. On the ground the wheels roll and steer (A/D), brake (Space), the taildragger sits on
// its tail wheel until its tail lifts with speed, and the plane rotates (S) at its rotation speed and flies off when the
// wing carries it. A landing too hard, on a wing tip or nose first is a crash; so is the water, a wall or the ground.
//
// HELICOPTERS: the rotor spins up first; the collective (Shift up, Ctrl down) sets the climb, the cyclic (W/S, ←/→)
// tilts the disc and the tilt drives it along, swinging like a pendulum; the pedals (A/D) turn it, banking into the
// turn at speed; with nothing held it flares and settles into a hover.
// Skids land on the ground or on any roof (env.ground gives the roofs); too hard, too tilted or into a wall: a crash.
import { AIRCRAFT } from './aircraft-specs.js';

export const G = 9.81;
const CLMAX = 1.25, CL0 = 0.18, ALPHA_STALL = 0.26;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ------------------------------------------------------------------ quaternions ({x, y, z, w})
export const qmul = (a, b) => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
export const qaxis = (ax, ay, az, ang) => { const s = Math.sin(ang / 2); return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(ang / 2) }; };
export function qnorm(q) { const l = Math.hypot(q.x, q.y, q.z, q.w) || 1; return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l }; }
/** v rotated by q. */
export function qrot(q, x, y, z) {
  const ix = q.w * x + q.y * z - q.z * y, iy = q.w * y + q.z * x - q.x * z, iz = q.w * z + q.x * y - q.y * x, iw = -q.x * x - q.y * y - q.z * z;
  return { x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y, y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z, z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x };
}
/** The orientation for a heading (the nose along (sin h, cos h)), a pitch (nose up +) and a bank (right wing down +). */
export const fromAngles = (h, pitch = 0, bank = 0) => qnorm(qmul(qmul(qaxis(0, 1, 0, h), qaxis(1, 0, 0, -pitch)), qaxis(0, 0, 1, bank)));
/** Heading, pitch and bank of an orientation. */
export function anglesOf(q) {
  const f = qrot(q, 0, 0, 1), l = qrot(q, 1, 0, 0);
  return { heading: Math.atan2(f.x, f.z), pitch: Math.asin(clamp(f.y, -1, 1)), bank: Math.asin(clamp(l.y, -1, 1)) };
}

// ------------------------------------------------------------------ the aircraft's state
/** A new aircraft at rest: at (x, y on its wheels, z), heading h. */
export function newFlight(type, x, groundY, z, h) {
  const S = AIRCRAFT[type];
  const pitch = S.kind === 'plane' ? S.restPitch : 0;
  return { type, p: { x, y: groundY + S.gearH, z }, v: { x: 0, y: 0, z: 0 }, q: fromAngles(h, pitch, 0),
    throttle: 0, engine: 0, rpm: 0, onGround: true, crashed: null, stall: false, tilt: { f: 0, s: 0 }, t: 0, agl: 0 };
}
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * One step of dt seconds (call it with small steps: 1/120 s). input: { throttle (−1..1: Shift up / Ctrl down, a rate),
 * pitch (−1..1: S nose up +), roll (−1..1: D right +), yaw (−1..1: right +), brake (bool), strafe (−1..1, helicopter) }.
 * env: { ground(x, z) → the height of the ground or a roof under it, water(x, z) → the water's level there or null,
 * solid(x, y, z) → what is there (a wall) or null }. Sets state.crashed to the reason when it crashes.
 */
export function stepFlight(s, input, env, dt) {
  if (s.crashed) return s;
  const S = AIRCRAFT[s.type];
  s.t += dt;
  return S.kind === 'heli' ? stepHeli(s, S, input, env, dt) : stepPlane(s, S, input, env, dt);
}

function stepPlane(s, S, inp, env, dt) {
  // the throttle lever moves at half its range a second; the engine follows it
  s.throttle = clamp(s.throttle + (inp.throttle || 0) * 0.5 * dt, 0, 1);
  s.engine += (s.throttle - s.engine) * Math.min(1, dt * (S.id === 'jet' ? 0.9 : 2.2));
  let q = s.q;
  const f = qrot(q, 0, 0, 1), u = qrot(q, 0, 1, 0), l = qrot(q, 1, 0, 0), v = s.v;
  const V = Math.hypot(v.x, v.y, v.z), vf = dot(v, f), vu = dot(v, u), vl = dot(v, l);
  const alpha = Math.atan2(-vu, Math.max(1, vf));
  const aa = Math.abs(alpha);
  const cl = aa <= ALPHA_STALL ? CL0 + (alpha / ALPHA_STALL) * (CLMAX - CL0) : Math.sign(alpha) * CLMAX * Math.max(0.35, 1 - (aa - ALPHA_STALL) * 2.5);
  s.stall = aa > ALPHA_STALL && V > 3 && !s.onGround;
  const kL = G / (S.stall * S.stall * CLMAX), d0 = S.thrust / (S.max * S.max), di = 0.22 * G / (CLMAX * CLMAX * S.stall * S.stall);
  const lift = vf > 0 ? kL * vf * vf * cl : 0, drag = V * V * (d0 + di * cl * cl), thrust = s.engine * S.thrust;
  const ax = u.x * lift + f.x * thrust - (V > 0.01 ? (v.x / V) * drag : 0);
  let ay = u.y * lift + f.y * thrust - (V > 0.01 ? (v.y / V) * drag : 0) - G;
  const az = u.z * lift + f.z * thrust - (V > 0.01 ? (v.z / V) * drag : 0);
  if (s.p.y > 2600) ay -= (s.p.y - 2600) * 0.05;   // the ceiling: thin air
  v.x += ax * dt; v.y += ay * dt; v.z += az * dt;
  // the side of the fuselage and the fin stop sliding sideways
  const side = Math.min(1, dt * (s.onGround ? 12 : 2.5)) * vl;
  v.x -= l.x * side; v.y -= l.y * side; v.z -= l.z * side;
  // FLY-BY-WIRE (2026-10-14: "the plane moves way too much for the input"; how arcade and casual flight games and
  // FlightGear's keyboard FCS do it): the input is shaped (eased in, an expo curve: gentle near the middle, full at the
  // end), it asks for a RATE of pitch and roll, and the aircraft's rates follow that with damping (no snap, no overshoot);
  // let go and it holds - the flight path is held (the trim keeps the lift for a level turn, so a bank doesn't sink it),
  // a shallow bank levels itself, a steep one holds; bank and pitch have limits; the nose turns with the bank.
  const ang = anglesOf(q), auth = clamp(vf / S.rotate, 0, 1.15), flying = !s.onGround;
  const c = s.ctl || (s.ctl = { p: 0, r: 0, y: 0 }), w = s.w || (s.w = { p: 0, q: 0, r: 0 });
  // eased in (a key's full deflection takes about a third of a second), let go at once (no drift after the key is up)
  const ease = (x, to) => x + (to - x) * (1 - Math.exp(-dt * (Math.abs(to) < Math.abs(x) ? 22 : 7)));
  c.p = ease(c.p, inp.pitch || 0); c.r = ease(c.r, inp.roll || 0); c.y = ease(c.y, inp.yaw || 0);
  const expo = x => 0.35 * x + 0.65 * x * x * x;
  // pitch: a pitch rate on top of the trim that holds the flight path (the lift a level turn at this bank needs)
  const n = 1 / Math.max(0.35, Math.cos(clamp(ang.bank, -1.2, 1.2)));
  const need = n * G / (kL * Math.max(vf, 1) ** 2), trim = clamp((need - CL0) / (CLMAX - CL0) * ALPHA_STALL, -0.08, ALPHA_STALL * 0.92);
  let qT = expo(c.p) * S.pitchRate * auth - clamp(alpha - trim, -0.5, 0.5) * 2.2 * clamp(vf / S.stall, 0, 1);
  if ((ang.pitch > 1.0 && qT > 0) || (ang.pitch < -1.0 && qT < 0)) qT *= 0.1;   // ±57°: no loops by accident
  // roll: a roll rate; hands off, a shallow bank levels itself and a steeper one holds
  let pT = expo(c.r) * S.rollRate * auth;
  if (Math.abs(inp.roll || 0) < 0.06 && flying) {   // hands off: hold the bank it had when let go (a shallow one: wings level)
    if (s.holdBank == null) s.holdBank = Math.abs(ang.bank) < 0.21 ? 0 : ang.bank;
    pT = (s.holdBank - ang.bank) * (s.holdBank === 0 ? 1.6 : 4);
  } else s.holdBank = null;
  if (Math.abs(ang.bank) > S.maxBank && Math.sign(pT) === Math.sign(ang.bank)) pT = -Math.sign(ang.bank) * (Math.abs(ang.bank) - S.maxBank) * 2;
  const rT = expo(c.y) * S.yawRate * auth;
  // the rates follow what is asked, critically damped (about a tenth of a second)
  const k = 1 - Math.exp(-dt / 0.11);
  w.q += (qT - w.q) * k; w.p += (pT - w.p) * k; w.r += (rT - w.r) * k;
  q = qmul(q, qaxis(1, 0, 0, -w.q * dt));
  q = qmul(q, qaxis(0, 0, 1, w.p * dt));
  q = qmul(q, qaxis(0, 1, 0, -w.r * dt));
  if (flying && V > S.stall * 0.5) {   // coordinated: a banked wing turns the nose with the flight path
    const b = clamp(ang.bank, -1.3, 1.3);
    q = qmul(qaxis(0, 1, 0, -G * Math.tan(b) / Math.max(V, S.stall) * dt * Math.cos(ang.pitch)), q);
  }
  s.q = qnorm(q);
  // too fast: the airframe's limit
  const V2 = Math.hypot(v.x, v.y, v.z), Vmax = S.max * 1.3;
  if (V2 > Vmax) { v.x *= Vmax / V2; v.y *= Vmax / V2; v.z *= Vmax / V2; }
  s.p.x += v.x * dt; s.p.y += v.y * dt; s.p.z += v.z * dt;
  contactPlane(s, S, inp, env, dt);
  return s;
}

/** The wheels on the ground: landing, rolling, braking, steering, the tail wheel; and what crashes a plane. */
function contactPlane(s, S, inp, env, dt) {
  const { p, v } = s, hG = env.ground(p.x, p.z), w = env.water?.(p.x, p.z);
  s.agl = p.y - S.gearH - hG;
  const hit = env.solid?.(p.x, p.y, p.z);
  if (hit) return crash(s, `You hit ${hit}`);
  if (w != null && p.y - S.gearH < w + 0.2 && hG < w) return crash(s, 'You came down in the water');
  if (s.agl > 0.02) { s.onGround = false; return; }
  const a = anglesOf(s.q), vf = dot(v, qrot(s.q, 0, 0, 1));
  // the ground rising ahead (m per m, along the way it moves): a hillside is not a runway - flown level into one at speed
  // it counted as a landing and the plane rolled up the mountain (2026-10-14)
  const sp0 = Math.hypot(v.x, v.z), rise = sp0 > 3 ? (env.ground(p.x + v.x / sp0 * 6, p.z + v.z / sp0 * 6) - hG) / 6 : 0;
  if (!s.onGround) {   // touching down
    if (-v.y > S.crashVy) return crash(s, `Too hard a landing (${(-v.y).toFixed(1)} m/s down)`);
    if (Math.abs(a.bank) > 0.42) return crash(s, 'A wing tip hit the ground');
    if (a.pitch < -0.16) return crash(s, 'Nose first into the ground');
    if (vf < -1) return crash(s, 'Backwards into the ground');
    if (rise > 0.2) return crash(s, 'You flew into the hillside');
    if (vf > S.rotate * 1.9) return crash(s, `Far too fast to land (${Math.round(vf * 1.944)} kt)`);
  } else if (sp0 > 12 && rise > 0.3) return crash(s, 'You ran into the hillside');
  s.onGround = true;
  p.y = hG + S.gearH; if (v.y < 0) v.y = 0;
  // rolling: brakes, friction; the wheels steer (A/D) - the faster, the gentler
  const decel = (inp.brake ? 4.5 : 0) + 0.18 + (s.throttle < 0.05 ? 0.25 : 0);
  const sp = Math.hypot(v.x, v.z);
  if (sp > 0) { const k = Math.max(0, sp - decel * dt) / sp; v.x *= k; v.z *= k; }
  const steer = -(inp.roll || 0) * (0.75 / (1 + Math.max(0, vf) / 12)) * clamp(Math.abs(vf) / 3, 0, 1);
  // the attitude on the wheels: wings level; the taildragger on its tail wheel until the tail lifts; rotation (S) at speed
  const rest = S.restPitch * (1 - clamp(vf / (0.6 * S.rotate), 0, 1));
  let pitch = clamp(a.pitch, rest, rest + (vf > S.rotate * 0.85 ? S.maxRotate : 0.02));
  if (vf < S.rotate * 0.85) pitch += (rest - pitch) * Math.min(1, dt * 3);
  const h = a.heading + steer * dt;
  s.q = fromAngles(h, pitch, a.bank * Math.max(0, 1 - dt * 8));
  if (s.w) s.w.p = 0;
  // the wheels roll along the heading
  const fx = Math.sin(h), fz = Math.cos(h), along = v.x * fx + v.z * fz;
  v.x = fx * along; v.z = fz * along;
}

function stepHeli(s, S, inp, env, dt) {
  s.rpm = Math.min(1, s.rpm + dt / 4);   // the rotor spins up over four seconds
  const lifting = s.rpm > 0.85;
  s.throttle = s.rpm;
  // THE SWAY (2026-10-14, "it needs that helicopter swaying feel": as flight simulators and Battlefield's helicopters do
  // it). The fuselage hangs under the rotor like a pendulum: the disc's tilt (the cyclic: W/S, Z/C) follows the stick on
  // an underdamped spring, so it swings a little past and rocks back - the nose dips as it sets off and comes up as it
  // slows. Hands off, the pilot flares: the disc tilts against the way it is going, the nose comes up, it slows into a
  // hover and levels. The pedals (A/D) turn it; at speed it banks into the turn and carves (a coordinated turn: the bank
  // the turn needs, the way it goes turning with the nose) - the faster, the wider; the tail fin turns the nose into the
  // airflow; sideways it slides a little before the fuselage stops it.
  const expo = x => 0.35 * x + 0.65 * x * x * x, cyc = clamp(-(inp.pitch || 0), -1, 1), side = clamp(inp.strafe || 0, -1, 1);
  const v = s.v, sp = Math.hypot(v.x, v.z), air = lifting && !s.onGround;
  let h = anglesOf(s.q).heading;
  const f0x = Math.sin(h), f0z = Math.cos(h), vf0 = v.x * f0x + v.z * f0z, vs0 = -v.x * f0z + v.z * f0x;
  // the pedals: a turn rate eased in and out; at speed no faster than a bank of 45° carries
  const yawMax = Math.min(S.yawRate, Math.max(0.25, G / Math.max(1, sp)));
  const yawT = expo(clamp(inp.yaw ?? inp.roll ?? 0, -1, 1)) * yawMax * (s.onGround && !lifting ? 0 : 1), yr = s.yawRate || 0;
  s.yawRate = yr + (yawT - yr) * (1 - Math.exp(-dt / (Math.abs(yawT) < Math.abs(yr) ? 0.2 : 0.3)));
  const vane = air ? Math.atan2(vs0, Math.max(5, vf0)) * 1.2 * clamp(vf0 / 20, 0, 1) : 0;   // (sliding right: the nose turns right)
  h -= (s.yawRate + vane) * dt;
  const fx = Math.sin(h), fz = Math.cos(h), rx = -Math.cos(h), rz = Math.sin(h);   // forward, and the right side
  const vf = v.x * fx + v.z * fz, vs = v.x * rx + v.z * rz;
  // where the disc is asked to tilt: the stick; hands off in the air, a flare against the way it goes; turning at speed,
  // the bank the turn needs on top (a right turn: the right side down)
  let tf = expo(cyc) * S.maxTilt, ts = expo(side) * S.maxTilt * 0.65;
  if (air && Math.abs(cyc) < 0.05 && Math.abs(side) < 0.05) { tf = clamp(-vf * 0.06, -S.maxTilt * 0.7, S.maxTilt * 0.7); ts = clamp(-vs * 0.06, -S.maxTilt * 0.5, S.maxTilt * 0.5); }
  if (air) ts = clamp(ts + Math.atan(Math.max(0, vf) * s.yawRate / G), -0.8, 0.8);
  // the disc follows on an underdamped spring: the pendulum (about a fifth past, settled in about a second and a half)
  const W0 = 5.5, ZETA = 0.45, tr = s.tr || (s.tr = { f: 0, s: 0 });
  tr.f += (W0 * W0 * (tf - s.tilt.f) - 2 * ZETA * W0 * tr.f) * dt; s.tilt.f += tr.f * dt;
  tr.s += (W0 * W0 * (ts - s.tilt.s) - 2 * ZETA * W0 * tr.s) * dt; s.tilt.s += tr.s * dt;
  const kh = G * Math.tan(S.maxTilt) / S.max;
  if (air) {   // the tilted disc drives it along; drag along the way it goes, more sideways (the fuselage's side)
    const af = G * Math.tan(s.tilt.f), as = G * Math.tan(s.tilt.s);
    v.x += (fx * af + rx * as - v.x * kh - rx * vs * 0.3) * dt; v.z += (fz * af + rz * as - v.z * kh - rz * vs * 0.3) * dt;
  }
  const coll = inp.throttle || 0;
  let target = coll > 0 ? coll * S.climb : coll < 0 ? coll * S.descend : 0;
  if (target < 0 && s.agl < 10) target = Math.max(target, -1.2 - s.agl * 0.25);   // near the ground the pilot eases the descent (a flare)
  if (lifting) v.y += ((target - v.y) * 1.6) * dt;
  else v.y -= G * dt;
  // the attitude is the disc's, the nose a little less down as the speed builds (the fuselage streamlines)
  s.q = fromAngles(h, -s.tilt.f * (1 - 0.6 * clamp(vf / (0.6 * S.max), 0, 1)), s.tilt.s);
  s.p.x += v.x * dt; s.p.y += v.y * dt; s.p.z += v.z * dt;
  const { p } = s, hG = env.ground(p.x, p.z), w = env.water?.(p.x, p.z);
  s.agl = p.y - S.gearH - hG;
  const hit = env.solid?.(p.x, p.y - S.gearH + 0.4, p.z);
  if (hit && s.agl < -0.05) return crash(s, `You hit ${hit}`);
  if (w != null && p.y - S.gearH < w + 0.1 && hG < w) return crash(s, 'You came down in the water');
  if (s.agl > 0.02) { s.onGround = false; return s; }
  if (!s.onGround) {
    if (-v.y > S.crashVy) return crash(s, `Too hard a landing (${(-v.y).toFixed(1)} m/s down)`);
    if (Math.abs(s.tilt.f) > 0.4 || Math.abs(s.tilt.s) > 0.4) return crash(s, 'It rolled over landing');
    if (Math.hypot(v.x, v.z) > 9) return crash(s, 'Too fast along the ground');
  }
  s.onGround = true;
  p.y = hG + S.gearH;
  if (v.y < 0) v.y = 0;
  const k = Math.max(0, 1 - dt * 6); v.x *= k; v.z *= k;
  s.tilt.f *= Math.max(0, 1 - dt * 5); s.tilt.s *= Math.max(0, 1 - dt * 5); if (s.tr) s.tr.f = s.tr.s = 0;
  if (coll > 0 && lifting) { s.onGround = false; v.y = Math.max(v.y, 0.5); }
  return s;
}

function crash(s, why) { s.crashed = why; s.v = { x: 0, y: 0, z: 0 }; return s; }

/** What the instruments show: airspeed (m/s), ground speed, height over the ground, vertical speed, heading (degrees 0–359
 *  from +z towards +x), pitch and bank (degrees), throttle (0–1), stall. */
export function instruments(s) {
  const a = anglesOf(s.q), v = s.v;
  return { speed: Math.hypot(v.x, v.y, v.z), ground: Math.hypot(v.x, v.z), agl: Math.max(0, s.agl), alt: s.p.y, vs: v.y,
    heading: ((Math.round(a.heading * 180 / Math.PI) % 360) + 360) % 360, pitch: a.pitch * 180 / Math.PI, bank: a.bank * 180 / Math.PI,
    throttle: AIRCRAFT[s.type].kind === 'heli' ? s.rpm : s.throttle, stall: s.stall, onGround: s.onGround };
}
