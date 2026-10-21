// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Shift while driving: boost (2026-10-05: "like a boosted speed for the car, extra acceleration to go faster and
// burnout" - Shift used to brake; S still brakes). Moving, a boost pushes the car on harder and lets it run past its usual
// top speed (BOOST.top × its handling's maxSpeed, within the server's pose check of 1.25 × + 4 m/s). Held with the
// throttle from a standstill it first does a burnout - the reference dynamics' own (rear wheels spinning on held front
// brakes, smoke-free tyre marks), BOOST.burn seconds - then launches.
// The reference module (shared/driving-classic, hash-pinned) is not touched: this runs around its beforeStep on the
// server (server/world/vehicles.js) and in the browser's own simulation (shared/vehicle-local.js) alike, so both agree.
import { VEHICLE_HANDLING } from './driving-classic/vehicle-dynamics.mjs';

export const BOOST = Object.freeze({ accel: 0.85, top: 1.3, burn: 1.0, still: 2.5 });

/** The boost button for vehicle id (true/false), from its driver's input. */
export function setBoost(dynamics, id, on) {
  const M = (dynamics.boost ??= new Map());
  const b = M.get(id) || { on: false, burnT: 0, launched: false };
  b.on = !!on; if (!b.on) { b.burnT = 0; b.launched = false; }
  M.set(id, b);
}
const typeOf = v => v.handling || VEHICLE_HANDLING.car;
/** Before VehicleDynamics.beforeStep: a burnout from a standstill holds the module's burnout (throttle + brake). */
export function boostBefore(dynamics, dt) {
  for (const [id, b] of dynamics.boost || []) {
    const v = dynamics.get(id);
    if (!v || !b.on) continue;
    const c = v.controls, speed = Math.abs(v.speed || 0);
    if (c.throttle < 0.5) { b.burnT = 0; b.launched = false; continue; }
    if (!b.launched && speed < BOOST.still && b.burnT < BOOST.burn) { b.burnT += dt; v.controls = { ...c, brake: 1 }; continue; }
    b.launched = true;
    if (c.brake) v.controls = { ...c, brake: 0 };
  }
}
/** After beforeStep, before the physics step: the boost's extra push along the car's heading, fading out at its boosted
 *  top speed (the module's own engine fades at the usual one). */
export function boostAfter(dynamics, dt) {
  for (const [id, b] of dynamics.boost || []) {
    const v = dynamics.get(id);
    if (!v || !b.on || !b.launched || v.controls.throttle < 0.5) continue;
    const H = typeOf(v), speed = v.speed || 0;
    if (speed < -0.5) continue;   // reversing: no boost
    const curve = Math.max(0, 1 - (speed / (H.maxSpeed * BOOST.top)) ** 2);
    if (curve <= 0) continue;
    const yaw = v.yaw || 0, k = v.mass * H.acceleration * BOOST.accel * curve * v.controls.throttle * dt;
    v.body.applyImpulse({ x: Math.cos(yaw) * k, y: 0, z: -Math.sin(yaw) * k }, true);
  }
}
/** Whether vehicle id is boosting right now (for the HUD): 'burnout', 'boost' or null. */
export function boostState(dynamics, id) {
  const b = dynamics.boost?.get(id), v = dynamics.get(id);
  if (!b?.on || !v || v.controls.throttle < 0.5) return null;
  return b.launched ? 'boost' : 'burnout';
}
