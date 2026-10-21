// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Vehicles and the island's water (WP4.3): the same rule wherever a car is simulated (the driver's browser, the server).
// Water slows a car (drag grows with the depth it wades through), and a car can't drive into water deeper than its
// wading depth: the engine gives no power toward deeper water past WADE_START and none at all at WADE_MAX, while
// driving back toward shallower water keeps full power - so a car always gets out the way it came and never crosses
// the sea floor. The server also refuses a driver's pose in water deeper than POSE_MAX_DEPTH (a pose no honest
// browser could produce).
export const WADE_START = 0.3;       // m of water under the car where power toward deeper water starts to fade
export const WADE_MAX = 0.7;         // m: no power toward deeper water beyond this
export const POSE_MAX_DEPTH = 1.6;   // m: deeper than this a driver's pose is refused
const LOOK = 3.5;                    // m ahead (in the direction the engine pushes) the depth is compared at

/** Water depth over the ground at (x, z), 0 on dry land. `island`: shared/terrain.js Island (or anything with waterAt and height). */
export function waterDepth(island, x, z) {
  const w = island.waterAt(x, z);
  return w ? Math.max(0, w.level - island.height(x, z)) : 0;
}

/**
 * Before each physics step, after the controls are set: fade the engine toward deeper water and add the water's drag.
 * `dynamics`: shared/driving-classic VehicleDynamics; `island`: the world's Island; `ids`: the vehicles to treat (all when
 * omitted). Returns how many vehicles were in water.
 */
export function applyWater(dynamics, island, dt, ids = null) {
  let wet = 0;
  for (const [id, v] of dynamics.vehicles) {
    if (ids && !ids.has(id)) continue;
    const p = v.body.translation(), here = waterDepth(island, p.x, p.z);
    // The driver's own throttle and brake, kept per controls object: on the server controls stay set between steps, so the
    // faded value is worked out from the request every step, never from the last faded value.
    const c = v.controls;
    if (c && v.waterInput?.of !== c) v.waterInput = { of: c, throttle: c.throttle, brake: c.brake };
    if (c) { c.throttle = v.waterInput.throttle; c.brake = v.waterInput.brake; }
    if (c && Math.abs(c.throttle) > 0.01) {
      // forward is +x rotated by yaw (vehicle-dynamics: speed = vx·cos(yaw) − vz·sin(yaw))
      const dir = Math.sign(c.throttle), fx = Math.cos(v.yaw) * dir, fz = -Math.sin(v.yaw) * dir;
      const ahead = waterDepth(island, p.x + fx * LOOK, p.z + fz * LOOK);
      if (ahead > here + 0.02) {
        const k = Math.min(1, Math.max(0, (ahead - WADE_START) / (WADE_MAX - WADE_START)));
        c.throttle *= 1 - k;
      }
    }
    // A car the engine isn't pushing out bogs down (soft bottom): its brakes hold it so it doesn't roll deeper.
    if (c && here > WADE_START && Math.abs(c.throttle) < 0.03) c.brake = Math.max(c.brake || 0, Math.min(1, (here - WADE_START) / (WADE_MAX - WADE_START)));
    if (here <= 0.05) continue;
    wet++;
    const vel = v.body.linvel(), d = Math.min(here, 1.2), k = v.mass * (0.6 + 2.4 * d) * dt;
    v.body.applyImpulse({ x: -vel.x * k, y: 0, z: -vel.z * k }, true);
  }
  return wet;
}
