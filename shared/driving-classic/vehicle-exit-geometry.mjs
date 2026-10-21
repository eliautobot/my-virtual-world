// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import {getTrafficVehicleSpec} from './traffic-vehicles.mjs';
export const VEHICLE_EXIT_MAX_DISTANCE = 6;
const finitePoint = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]));

/** Upright capsule must be beyond the complete horizontal coachwork envelope.
 * Margin exceeds the actual capsule radius. Shared by browser and authority.
 */
export function outsideVehicleFootprint(point, vehicle, margin = .35) {
  if (!finitePoint(point) || !finitePoint(vehicle?.position) || !Number.isFinite(vehicle.yaw)) return false;
  const spec = getTrafficVehicleSpec(vehicle.type);
  const dx = point.x - vehicle.position.x, dz = point.z - vehicle.position.z;
  const c = Math.cos(vehicle.yaw), s = Math.sin(vehicle.yaw);
  return Math.abs(dx * c - dz * s) > spec.halfLength + margin
    || Math.abs(dx * s + dz * c) > spec.halfWidth + margin;
}

/** Left door first (vehicle forward is +X), then right, then nearby corners and
 * ends. Candidates never use an old entry point or a distant world origin.
 * Ground sampling must resolve the current terrain, not the vehicle roof.
 */
export function vehicleExitCandidates(vehicle, groundAt, {maxDistance = VEHICLE_EXIT_MAX_DISTANCE} = {}) {
  if (!finitePoint(vehicle?.position) || !Number.isFinite(vehicle.yaw) || typeof groundAt !== 'function') return [];
  const spec = getTrafficVehicleSpec(vehicle.type), p = vehicle.position;
  const c = Math.cos(vehicle.yaw), s = Math.sin(vehicle.yaw), out = [];
  const side = spec.halfWidth + .8, end = spec.halfLength + .8;
  const offsets = [[0, -side], [0, side]];
  for (const x of [-Math.min(1.4, spec.halfLength * .6), Math.min(1.4, spec.halfLength * .6)]) offsets.push([x, -side], [x, side]);
  offsets.push([-end, 0], [end, 0]);
  for (const extra of [.5, 1]) offsets.push([0, -side - extra], [0, side + extra], [-end - extra, 0], [end + extra, 0]);
  for (const [x, z] of offsets) {
    if (Math.hypot(x, z) > maxDistance) continue;
    const point = {x: p.x + x * c + z * s, y: 0, z: p.z - x * s + z * c};
    point.y = groundAt(point.x, point.z);
    if (finitePoint(point) && Math.abs(point.y - p.y) <= 2 && outsideVehicleFootprint(point, vehicle)) out.push(point);
  }
  return out;
}

export function findVehicleExit(vehicle, groundAt, canStand) {
  if (typeof canStand !== 'function') return null;
  return vehicleExitCandidates(vehicle, groundAt).find(p => canStand(p)) || null;
}
