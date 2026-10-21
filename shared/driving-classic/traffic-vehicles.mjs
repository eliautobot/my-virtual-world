// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import { createFleetTrafficSpec } from './fleet-vehicle-proportions.mjs';
import { getSedanProportions } from './sedan-proportions.mjs';

// The roadway has a 0.3-wide center marking area between two 2.5-wide lanes.
// Routes are centered in each travel lane, not on the inner edge of the lane.
export const TRAFFIC_LANE_OFFSET = (2.5 + 0.3) * 0.5;
export const TRAFFIC_TURN_RADIUS = 3.1;
export const TRAFFIC_TURNAROUND_MIN_SAMPLES = 5;
export const TRAFFIC_TURNAROUND_MAX_SAMPLES = 12;

function standardPassengerSpec(type, speedMult) {
  const d = getSedanProportions(type);
  return Object.freeze({ speedMult, wheelRadius: d.wheelRadius, collisionRadius: d.collisionRadius, halfLength: d.halfLength, halfWidth: d.halfWidth, detailDistance: 68 });
}

export const TRAFFIC_VEHICLE_SPECS = Object.freeze({
  car: standardPassengerSpec('car', 1),
  sedan: standardPassengerSpec('sedan', 1.05),
  taxi: createFleetTrafficSpec('taxi', 1),
  truck: createFleetTrafficSpec('truck',0.8),
  suv: createFleetTrafficSpec('suv', 0.92),
  van: createFleetTrafficSpec('van', 0.85),
  police: createFleetTrafficSpec('police', 1.08),
  ambulance: createFleetTrafficSpec('ambulance',0.82),
  bus: createFleetTrafficSpec('bus',0.65),
});

export const TRAFFIC_VEHICLE_SPAWN_TYPES = Object.freeze([
  'car',
  'sedan',
  'taxi',
  'truck',
  'suv',
  'van',
  'car',
  'police',
  'ambulance',
  'bus',
]);

const FALLBACK_SPEC = TRAFFIC_VEHICLE_SPECS.car;
const EPSILON = 1e-6;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeAxisDirection(from, to) {
  const dx = finite(to?.x) - finite(from?.x);
  const dz = finite(to?.z) - finite(from?.z);
  if (Math.abs(dx) < EPSILON && Math.abs(dz) < EPSILON) return null;
  return Math.abs(dx) >= Math.abs(dz)
    ? { x: Math.sign(dx) || 1, z: 0 }
    : { x: 0, z: Math.sign(dz) || 1 };
}

function rightOf(direction) {
  return { x: -direction.z, z: direction.x };
}

function add(point, direction, distance) {
  return {
    x: finite(point?.x) + direction.x * distance,
    z: finite(point?.z) + direction.z * distance,
  };
}

function cross(a, b) {
  return a.x * b.z - a.z * b.x;
}

function appendPoint(points, point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return;
  const previous = points[points.length - 1];
  if (previous && Math.hypot(point.x - previous.x, point.z - previous.z) < 0.001) return;
  points.push({ x: point.x, z: point.z });
}

function tangentIntersection(entry, incoming, exit, outgoing) {
  const reverseOutgoing = { x: -outgoing.x, z: -outgoing.z };
  const denominator = cross(incoming, reverseOutgoing);
  if (Math.abs(denominator) < EPSILON) return null;
  const delta = { x: exit.x - entry.x, z: exit.z - entry.z };
  const distance = cross(delta, reverseOutgoing) / denominator;
  return add(entry, incoming, distance);
}

function appendQuadratic(points, start, control, end, samples) {
  appendPoint(points, start);
  for (let index = 1; index <= samples; index++) {
    const t = index / samples;
    const inverse = 1 - t;
    appendPoint(points, {
      x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
      z: inverse * inverse * start.z + 2 * inverse * t * control.z + t * t * end.z,
    });
  }
}

function appendUTurn(points, center, incoming, laneOffset, samples) {
  const right = rightOf(incoming);
  for (let index = 1; index <= samples; index++) {
    const angle = Math.PI * index / samples;
    appendPoint(points, {
      x: center.x + right.x * Math.cos(angle) * laneOffset + incoming.x * Math.sin(angle) * laneOffset,
      z: center.z + right.z * Math.cos(angle) * laneOffset + incoming.z * Math.sin(angle) * laneOffset,
    });
  }
}

function buildDirectionalLanePath(centerline, { laneOffset, turnRadius, curveSamples }) {
  const points = [];
  if (centerline.length < 2) return points;
  const directions = [];
  for (let index = 0; index < centerline.length - 1; index++) {
    directions.push(normalizeAxisDirection(centerline[index], centerline[index + 1]));
  }
  if (!directions[0]) return points;
  appendPoint(points, add(centerline[0], rightOf(directions[0]), laneOffset));

  for (let index = 1; index < centerline.length - 1; index++) {
    const incoming = directions[index - 1];
    const outgoing = directions[index];
    if (!incoming || !outgoing) continue;
    const node = centerline[index];
    const dot = incoming.x * outgoing.x + incoming.z * outgoing.z;
    if (dot > 0.5) {
      appendPoint(points, add(node, rightOf(incoming), laneOffset));
      continue;
    }
    if (dot < -0.5) {
      appendPoint(points, add(node, rightOf(incoming), laneOffset));
      appendUTurn(points, node, incoming, laneOffset, Math.max(4, curveSamples * 2));
      continue;
    }

    const previousLength = Math.hypot(node.x - centerline[index - 1].x, node.z - centerline[index - 1].z);
    const nextLength = Math.hypot(centerline[index + 1].x - node.x, centerline[index + 1].z - node.z);
    const radius = Math.max(0.5, Math.min(turnRadius, previousLength * 0.42, nextLength * 0.42));
    const entry = add(add(node, incoming, -radius), rightOf(incoming), laneOffset);
    const exit = add(add(node, outgoing, radius), rightOf(outgoing), laneOffset);
    const control = tangentIntersection(entry, incoming, exit, outgoing) || node;
    appendQuadratic(points, entry, control, exit, curveSamples);
  }

  const lastDirection = directions[directions.length - 1];
  appendPoint(points, add(centerline[centerline.length - 1], rightOf(lastDirection), laneOffset));
  return points;
}

function normalizeCenterline(path) {
  const points = [];
  for (const raw of Array.isArray(path) ? path : []) {
    const point = { x: finite(raw?.x, NaN), z: finite(raw?.z, NaN) };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) continue;
    appendPoint(points, point);
  }
  return points;
}

export function getTrafficVehicleSpec(type) {
  return TRAFFIC_VEHICLE_SPECS[String(type || '').toLowerCase()] || FALLBACK_SPEC;
}

export function getTrafficVehicleRideHeight(type, modelScale = 2) {
  const spec = getTrafficVehicleSpec(type);
  return (0.18 + spec.wheelRadius) * Math.max(0.1, finite(modelScale, 2)) + 0.012;
}

export function getTrafficVehicleWheelSpinRadians(type, distance, modelScale = 2) {
  const spec = getTrafficVehicleSpec(type);
  const worldRadius = spec.wheelRadius * Math.max(0.1, finite(modelScale, 2));
  return finite(distance) / worldRadius;
}

/**
 * Builds one closed, right-hand-traffic route from a centerline graph path.
 * Corners use tangent quadratic curves; reversals occur only around the two
 * supplied graph endpoints, never along a street segment.
 */
export function buildLaneAwareTrafficLoop(path, {
  laneOffset = TRAFFIC_LANE_OFFSET,
  turnRadius = TRAFFIC_TURN_RADIUS,
  curveSamples = 4,
  uTurnSamples = 7,
} = {}) {
  const centerline = normalizeCenterline(path);
  if (centerline.length < 2) return Object.freeze([]);
  const safeLaneOffset = Math.max(0.25, finite(laneOffset, TRAFFIC_LANE_OFFSET));
  const safeTurnRadius = Math.max(safeLaneOffset, finite(turnRadius, TRAFFIC_TURN_RADIUS));
  const safeCurveSamples = clamp(Math.floor(finite(curveSamples, 4)), 2, 8);
  const safeUTurnSamples = clamp(Math.floor(finite(uTurnSamples, 7)), 5, 12);
  const forward = buildDirectionalLanePath(centerline, {
    laneOffset: safeLaneOffset,
    turnRadius: safeTurnRadius,
    curveSamples: safeCurveSamples,
  });
  const reverseCenterline = [...centerline].reverse();
  const reverse = buildDirectionalLanePath(reverseCenterline, {
    laneOffset: safeLaneOffset,
    turnRadius: safeTurnRadius,
    curveSamples: safeCurveSamples,
  });
  if (forward.length < 2 || reverse.length < 2) return Object.freeze([]);

  const loop = [...forward];
  const endDirection = normalizeAxisDirection(centerline[centerline.length - 2], centerline[centerline.length - 1]);
  appendUTurn(loop, centerline[centerline.length - 1], endDirection, safeLaneOffset, safeUTurnSamples);
  for (let index = 1; index < reverse.length; index++) appendPoint(loop, reverse[index]);
  const reverseStartDirection = normalizeAxisDirection(centerline[1], centerline[0]);
  appendUTurn(loop, centerline[0], reverseStartDirection, safeLaneOffset, safeUTurnSamples);
  return Object.freeze(loop.map(point => Object.freeze(point)));
}

/**
 * Finds the two terminal semicircles in a generated traffic loop. Road routes
 * are persisted as plain points, so the authoritative runtime reconstructs
 * this small amount of maneuver metadata from geometry after a restart.
 */
export function findTrafficPathTurnarounds(path, {
  laneOffset = TRAFFIC_LANE_OFFSET,
  minimumSamples = TRAFFIC_TURNAROUND_MIN_SAMPLES,
  maximumSamples = TRAFFIC_TURNAROUND_MAX_SAMPLES,
} = {}) {
  const points = normalizeCenterline(path);
  if (points.length < minimumSamples + 2) return Object.freeze([]);
  const safeLaneOffset = Math.max(0.25, finite(laneOffset, TRAFFIC_LANE_OFFSET));
  const minSamples = clamp(Math.floor(finite(minimumSamples, TRAFFIC_TURNAROUND_MIN_SAMPLES)), 3, 16);
  const maxSamples = clamp(Math.floor(finite(maximumSamples, TRAFFIC_TURNAROUND_MAX_SAMPLES)), minSamples, 20);
  const expectedChord = safeLaneOffset * 2;
  const expectedArcLength = Math.PI * safeLaneOffset;
  const found = [];
  let startIndex = 0;
  while (startIndex < points.length - minSamples) {
    let match = null;
    const lastEndIndex = Math.min(points.length - 1, startIndex + maxSamples);
    for (let endIndex = startIndex + minSamples; endIndex <= lastEndIndex; endIndex++) {
      const start = points[startIndex];
      const end = points[endIndex];
      const chord = Math.hypot(end.x - start.x, end.z - start.z);
      if (Math.abs(chord - expectedChord) > Math.max(0.18, safeLaneOffset * 0.16)) continue;
      let arcLength = 0;
      for (let index = startIndex + 1; index <= endIndex; index++) {
        arcLength += Math.hypot(
          points[index].x - points[index - 1].x,
          points[index].z - points[index - 1].z,
        );
      }
      if (Math.abs(arcLength - expectedArcLength) > expectedArcLength * 0.18) continue;
      const firstDx = points[startIndex + 1].x - start.x;
      const firstDz = points[startIndex + 1].z - start.z;
      const lastDx = end.x - points[endIndex - 1].x;
      const lastDz = end.z - points[endIndex - 1].z;
      const firstLength = Math.hypot(firstDx, firstDz);
      const lastLength = Math.hypot(lastDx, lastDz);
      if (firstLength < EPSILON || lastLength < EPSILON) continue;
      const tangentDot = (firstDx * lastDx + firstDz * lastDz) / (firstLength * lastLength);
      if (tangentDot > -0.72) continue;
      const center = { x: (start.x + end.x) * 0.5, z: (start.z + end.z) * 0.5 };
      const radii = points.slice(startIndex, endIndex + 1)
        .map(point => Math.hypot(point.x - center.x, point.z - center.z));
      const minimumRadius = Math.min(...radii);
      const maximumRadius = Math.max(...radii);
      const meanRadius = radii.reduce((sum, radius) => sum + radius, 0) / radii.length;
      if (maximumRadius - minimumRadius > Math.max(0.12, safeLaneOffset * 0.12)) continue;
      if (Math.abs(meanRadius - safeLaneOffset) > Math.max(0.12, safeLaneOffset * 0.12)) continue;
      let nextIndex = (endIndex + 1) % points.length;
      let exitDx = points[nextIndex].x - end.x;
      let exitDz = points[nextIndex].z - end.z;
      let exitLength = Math.hypot(exitDx, exitDz);
      let guard = points.length;
      while (exitLength < EPSILON && guard-- > 0) {
        nextIndex = (nextIndex + 1) % points.length;
        exitDx = points[nextIndex].x - end.x;
        exitDz = points[nextIndex].z - end.z;
        exitLength = Math.hypot(exitDx, exitDz);
      }
      if (exitLength < EPSILON) continue;
      const keyX = Math.abs(center.x) < 0.0005 ? 0 : center.x;
      const keyZ = Math.abs(center.z) < 0.0005 ? 0 : center.z;
      match = Object.freeze({
        key: `${keyX.toFixed(3)},${keyZ.toFixed(3)}`,
        x: keyX,
        z: keyZ,
        radius: meanRadius,
        startIndex,
        endIndex,
        exitX: end.x,
        exitZ: end.z,
        exitDx: exitDx / exitLength,
        exitDz: exitDz / exitLength,
      });
      break;
    }
    if (!match) {
      startIndex++;
      continue;
    }
    found.push(match);
    startIndex = match.endIndex + 1;
  }
  return Object.freeze(found);
}

export function movementRotationY(dx, dz, fallback = 0) {
  const x = finite(dx);
  const z = finite(dz);
  return Math.hypot(x, z) < EPSILON ? finite(fallback) : -Math.atan2(z, x);
}

export function advanceTrafficPath(path, state, distance) {
  const points = Array.isArray(path) ? path : [];
  if (points.length < 2) return Object.freeze({ ...state, moved: 0, dx: 0, dz: 0 });
  let x = finite(state?.x, points[0].x);
  let z = finite(state?.z, points[0].z);
  let pathIdx = clamp(Math.floor(finite(state?.pathIdx, 1)), 1, points.length - 1);
  let remaining = Math.max(0, finite(distance));
  let moved = 0;
  let lastDx = 0;
  let lastDz = 0;
  let guard = points.length + 4;
  while (remaining > EPSILON && guard-- > 0) {
    const target = points[pathIdx];
    const dx = target.x - x;
    const dz = target.z - z;
    const segmentDistance = Math.hypot(dx, dz);
    if (segmentDistance <= EPSILON) {
      pathIdx++;
      if (pathIdx >= points.length) {
        x = points[0].x;
        z = points[0].z;
        pathIdx = 1;
      }
      continue;
    }
    const step = Math.min(segmentDistance, remaining);
    const unitX = dx / segmentDistance;
    const unitZ = dz / segmentDistance;
    x += unitX * step;
    z += unitZ * step;
    lastDx = unitX;
    lastDz = unitZ;
    moved += step;
    remaining -= step;
    if (step >= segmentDistance - EPSILON) {
      pathIdx++;
      if (pathIdx >= points.length) {
        x = points[0].x;
        z = points[0].z;
        pathIdx = 1;
      }
    }
  }
  return Object.freeze({ x, z, pathIdx, moved, dx: lastDx, dz: lastDz });
}

export function trafficPathForwardDistance(path, state, target) {
  const points = Array.isArray(path) ? path : [];
  if (points.length < 2) return Infinity;
  let x = finite(state?.x, points[0].x);
  let z = finite(state?.z, points[0].z);
  let pathIdx = clamp(Math.floor(finite(state?.pathIdx, 1)), 1, points.length - 1);
  const targetX = finite(target?.x, NaN);
  const targetZ = finite(target?.z, NaN);
  const targetIdx = clamp(Math.floor(finite(target?.pathIdx, pathIdx)), 1, points.length - 1);
  if (!Number.isFinite(targetX) || !Number.isFinite(targetZ)) return Infinity;
  let distance = 0;
  let guard = points.length + 2;
  while (guard-- > 0) {
    const waypoint = points[pathIdx];
    const dx = waypoint.x - x;
    const dz = waypoint.z - z;
    const segmentDistance = Math.hypot(dx, dz);
    if (pathIdx === targetIdx && segmentDistance > EPSILON) {
      const unitX = dx / segmentDistance;
      const unitZ = dz / segmentDistance;
      const toTargetX = targetX - x;
      const toTargetZ = targetZ - z;
      const along = toTargetX * unitX + toTargetZ * unitZ;
      const perpendicular = Math.abs(toTargetX * unitZ - toTargetZ * unitX);
      if (along >= -0.02 && along <= segmentDistance + 0.02 && perpendicular <= 0.08) {
        return distance + Math.max(0, along);
      }
    }
    distance += segmentDistance;
    x = waypoint.x;
    z = waypoint.z;
    pathIdx += 1;
    if (pathIdx >= points.length) {
      x = points[0].x;
      z = points[0].z;
      pathIdx = 1;
    }
  }
  return Infinity;
}

export function distancePointToTrafficSegment(point, start, end) {
  const dx = finite(end?.x) - finite(start?.x);
  const dz = finite(end?.z) - finite(start?.z);
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq < EPSILON) return Math.hypot(finite(point?.x) - finite(start?.x), finite(point?.z) - finite(start?.z));
  const amount = clamp(((finite(point?.x) - finite(start?.x)) * dx + (finite(point?.z) - finite(start?.z)) * dz) / lengthSq, 0, 1);
  return Math.hypot(
    finite(point?.x) - (finite(start?.x) + dx * amount),
    finite(point?.z) - (finite(start?.z) + dz * amount),
  );
}

export function getTrafficVehicleSeparation(typeA, typeB, padding = 0.22) {
  return getTrafficVehicleSpec(typeA).collisionRadius
    + getTrafficVehicleSpec(typeB).collisionRadius
    + Math.max(0, finite(padding, 0.22));
}

export function trafficVehiclesOverlap(vehicleA, vehicleB, padding = 0.22) {
  if (!vehicleA || !vehicleB) return false;
  return Math.hypot(finite(vehicleA.x) - finite(vehicleB.x), finite(vehicleA.z) - finite(vehicleB.z))
    < getTrafficVehicleSeparation(vehicleA.vehicleType, vehicleB.vehicleType, padding);
}

function trafficVehicleAxes(vehicle) {
  const rotationY = finite(vehicle?.rotationY);
  const forward = { x: Math.cos(rotationY), z: -Math.sin(rotationY) };
  return { forward, side: { x: -forward.z, z: forward.x } };
}

export function trafficVehicleFootprintsOverlap(vehicleA, vehicleB, padding = 0.04) {
  if (!vehicleA || !vehicleB) return false;
  const specA = getTrafficVehicleSpec(vehicleA.vehicleType);
  const specB = getTrafficVehicleSpec(vehicleB.vehicleType);
  const axesA = trafficVehicleAxes(vehicleA);
  const axesB = trafficVehicleAxes(vehicleB);
  const delta = { x: finite(vehicleB.x) - finite(vehicleA.x), z: finite(vehicleB.z) - finite(vehicleA.z) };
  const safePadding = Math.max(0, finite(padding, 0.04));
  for (const axis of [axesA.forward, axesA.side, axesB.forward, axesB.side]) {
    const centerDistance = Math.abs(delta.x * axis.x + delta.z * axis.z);
    const radiusA = specA.halfLength * Math.abs(axesA.forward.x * axis.x + axesA.forward.z * axis.z)
      + specA.halfWidth * Math.abs(axesA.side.x * axis.x + axesA.side.z * axis.z);
    const radiusB = specB.halfLength * Math.abs(axesB.forward.x * axis.x + axesB.forward.z * axis.z)
      + specB.halfWidth * Math.abs(axesB.side.x * axis.x + axesB.side.z * axis.z);
    if (centerDistance >= radiusA + radiusB + safePadding) return false;
  }
  return true;
}

export function analyzeTrafficPath(path) {
  const points = normalizeCenterline(path);
  let roundedSegmentCount = 0;
  let reversalCount = 0;
  let maximumStep = 0;
  for (let index = 1; index < points.length; index++) {
    const dx = points[index].x - points[index - 1].x;
    const dz = points[index].z - points[index - 1].z;
    maximumStep = Math.max(maximumStep, Math.hypot(dx, dz));
    if (Math.abs(dx) > 0.001 && Math.abs(dz) > 0.001) roundedSegmentCount++;
    if (index < points.length - 1) {
      const nextDx = points[index + 1].x - points[index].x;
      const nextDz = points[index + 1].z - points[index].z;
      if (dx * nextDx + dz * nextDz < -0.001) reversalCount++;
    }
  }
  return Object.freeze({ pointCount: points.length, roundedSegmentCount, reversalCount, maximumStep });
}
