// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import RAPIER from '@dimforge/rapier3d-compat';
export {outsideVehicleFootprint, vehicleExitCandidates, findVehicleExit, VEHICLE_EXIT_MAX_DISTANCE} from './vehicle-exit-geometry.mjs';

// Match physics.js/addAgentCollider and teleportAgent exactly. The former
// smaller/higher ragdoll probe missed low obstacles at an exit's feet.
export const VEHICLE_EXIT_CAPSULE = Object.freeze({halfHeight: .35, radius: .25, centerHeight: .7});
const IDENTITY = Object.freeze({x: 0, y: 0, z: 0, w: 1});
const exitCapsule = new RAPIER.Capsule(VEHICLE_EXIT_CAPSULE.halfHeight, VEHICLE_EXIT_CAPSULE.radius);
const finitePoint = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]));

/** Direct collider tests see current transforms even before a broadphase step.
 * Exclude only the exiting character's own capsule; never omit the car, other
 * characters, terrain, authored walkable meshes, or low obstacles wholesale.
 * Exit is a rare command, so correctness wins over frame-loop query shortcuts.
 */
export function isVehicleExitClear(world, point, {ignoreHandles = [], includeCollider = collider => !collider.isSensor()} = {}) {
  if (!world || !finitePoint(point)) return false;
  const ignored = new Set(ignoreHandles.filter(h => h != null));
  const center = {x: point.x, y: point.y + VEHICLE_EXIT_CAPSULE.centerHeight, z: point.z};
  let clear = true;
  world.forEachCollider(collider => {
    if (!clear || ignored.has(collider.handle) || !collider.isValid() || !includeCollider(collider)
      || collider.isEnabled?.() === false || collider.parent()?.isEnabled?.() === false) return;
    if (collider.intersectsShape(exitCapsule, center, IDENTITY)) clear = false;
  });
  return clear;
}

