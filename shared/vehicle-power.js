// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The cars' full power (2026-11-13: "the cars dont need a boost button or feature, lets just make the max speed be the
// current boost speed"). What Shift's boost used to add (2026-10-05) is now simply how the cars drive: the throttle pushes
// the car on harder than the reference dynamics' own engine and lets it run on to POWER.top × its handling's maxSpeed
// (within the server's pose check of 1.25 × + 4 m/s). There is no button for it and no boost state.
// A burnout is the reference dynamics' own: the brake held with the throttle from a standstill (rear wheels spinning on
// held front brakes) — this push waits while the brake is held, so the car stays put until the brake is let go.
// The reference module (shared/driving-classic, hash-pinned) is not touched: this runs after its beforeStep on the server
// (server/world/vehicles.js) and in the browser's own simulation (shared/vehicle-local.js) alike, so both agree.
import { VEHICLE_HANDLING } from './driving-classic/vehicle-dynamics.mjs';

export const POWER = Object.freeze({ accel: 0.85, top: 1.3 });

const typeOf = v => v.handling || VEHICLE_HANDLING.car;
/** The top speed a vehicle of this handling reaches on the throttle (m/s). */
export const topSpeed = handling => (handling || VEHICLE_HANDLING.car).maxSpeed * POWER.top;

/** After VehicleDynamics.beforeStep, before the physics step: the extra push along each car's heading while its throttle
 *  is forward, fading out at its full top speed (the module's own engine fades at its usual one). */
export function powerAfter(dynamics, dt) {
  for (const v of dynamics.vehicles?.values?.() || []) {
    const c = v.controls; if (!c || !v.body) continue;
    const throttle = Math.min(1, c.throttle || 0);
    if (throttle <= 0.02 || c.brake > 0.1) continue;   // reversing, coasting or braking (and a burnout's hold): no push
    const H = typeOf(v), speed = v.speed || 0;
    if (speed < -0.5) continue;   // still rolling backwards: the module brakes it first
    const curve = Math.max(0, 1 - (speed / (H.maxSpeed * POWER.top)) ** 2);
    if (curve <= 0) continue;
    const yaw = v.yaw || 0, k = v.mass * H.acceleration * POWER.accel * curve * throttle * dt;
    v.body.applyImpulse({ x: Math.cos(yaw) * k, y: 0, z: -Math.sin(yaw) * k }, true);
  }
}
