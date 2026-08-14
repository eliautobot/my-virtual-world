#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  TRAFFIC_LANE_OFFSET,
  advanceTrafficPath,
  analyzeTrafficPath,
  buildLaneAwareTrafficLoop,
  getTrafficVehicleRideHeight,
  getTrafficVehicleSeparation,
  movementRotationY,
  trafficPathForwardDistance,
  trafficVehicleFootprintsOverlap,
  trafficVehiclesOverlap,
} from '../src/client/js/traffic-vehicles.mjs';

const straightLoop = buildLaneAwareTrafficLoop([{ x: 0, z: 0 }, { x: 20, z: 0 }]);
assert(straightLoop.length >= 16, 'a two-way street loop must include two rounded endpoint U-turns');
assert.equal(straightLoop[0].x, 0, 'the route must begin at the graph endpoint');
assert.equal(straightLoop[0].z, TRAFFIC_LANE_OFFSET, 'eastbound traffic must begin in the right-hand lane');
assert(straightLoop.some(point => point.x > 20), 'the end-of-street U-turn must arc around the endpoint instead of reversing in place');
assert(straightLoop.some(point => point.x < 0), 'the return U-turn must arc around the opposite street endpoint');
assert(straightLoop.some(point => point.z < -TRAFFIC_LANE_OFFSET * 0.9), 'westbound traffic must use the opposite right-hand lane');

const cornerLoop = buildLaneAwareTrafficLoop([
  { x: 0, z: 0 },
  { x: 20, z: 0 },
  { x: 20, z: 20 },
]);
const cornerAnalysis = analyzeTrafficPath(cornerLoop);
assert(cornerAnalysis.roundedSegmentCount >= 6, 'orthogonal graph turns must be replaced by sampled curved motion');
assert.equal(cornerAnalysis.reversalCount, 0, 'the motion path must never contain an instantaneous direction reversal');
const approach = cornerLoop.filter(point => point.x > 16 && point.x < 20 && point.z > 1 && point.z < 5);
assert(approach.length > 0, 'the right turn must follow a continuous intersection-radius arc');

let state = { x: straightLoop[0].x, z: straightLoop[0].z, pathIdx: 1 };
let totalMoved = 0;
for (let index = 0; index < 200; index++) {
  const next = advanceTrafficPath(straightLoop, state, 0.65);
  totalMoved += next.moved;
  assert(next.pathIdx >= 1 && next.pathIdx < straightLoop.length, 'closed traffic paths must wrap without invalid waypoint indices');
  state = next;
}
assert(totalMoved > 100, 'traffic advancement must consume the complete per-tick travel distance across curve samples');

const curveStart = { ...cornerLoop[0], pathIdx: 1 };
const curveTarget = advanceTrafficPath(cornerLoop, curveStart, 24);
const curveDistance = trafficPathForwardDistance(cornerLoop, curveStart, curveTarget);
assert(Math.abs(curveDistance - 24) < 1e-6, 'client interpolation must recover the authoritative distance along the curved route');
const curveMidpoint = advanceTrafficPath(cornerLoop, curveStart, curveDistance * 0.5);
assert(
  analyzeTrafficPath([curveStart, curveMidpoint, curveTarget]).reversalCount === 0,
  'interpolating a traffic update must advance through route samples instead of cutting across the intersection',
);
const straightLoopLength = straightLoop.reduce((sum, point, index) => {
  const next = straightLoop[(index + 1) % straightLoop.length];
  return sum + Math.hypot(next.x - point.x, next.z - point.z);
}, 0);
const wrappedStart = advanceTrafficPath(straightLoop, { ...straightLoop[0], pathIdx: 1 }, straightLoopLength - 2);
const wrappedTarget = advanceTrafficPath(straightLoop, wrappedStart, 5);
assert(
  Math.abs(trafficPathForwardDistance(straightLoop, wrappedStart, wrappedTarget) - 5) < 1e-6,
  'client interpolation must preserve forward distance when an update crosses the route wrap point',
);

assert.equal(Number(movementRotationY(1, 1).toFixed(6)), Number((-Math.PI / 4).toFixed(6)), 'vehicle heading must follow the continuous movement tangent');
assert(getTrafficVehicleRideHeight('bus') > getTrafficVehicleRideHeight('car'), 'larger bus tires must receive a taller roadway ride height');
assert(getTrafficVehicleRideHeight('car') > 0.49, 'vehicle origin must be raised enough for the tire bottoms to rest on the road surface');
assert(getTrafficVehicleSeparation('bus', 'car') > getTrafficVehicleSeparation('car', 'car'), 'bus spacing must account for its longer body');
assert.equal(trafficVehiclesOverlap(
  { x: 0, z: 0, vehicleType: 'car' },
  { x: 1, z: 0, vehicleType: 'car' },
), true, 'nearby vehicle footprints must overlap');
assert.equal(trafficVehiclesOverlap(
  { x: 0, z: 0, vehicleType: 'car' },
  { x: 8, z: 0, vehicleType: 'bus' },
), false, 'well-spaced vehicles must remain independent');
assert.equal(trafficVehicleFootprintsOverlap(
  { x: 0, z: 1.125, rotationY: 0, vehicleType: 'car' },
  { x: 0.5, z: -1.125, rotationY: Math.PI, vehicleType: 'car' },
), false, 'cars in opposing lanes must pass without false circular-footprint collisions');
assert.equal(trafficVehicleFootprintsOverlap(
  { x: 0, z: 0, rotationY: 0, vehicleType: 'truck' },
  { x: 0.5, z: 0.2, rotationY: Math.PI / 2, vehicleType: 'van' },
), true, 'crossing truck and van footprints must detect a real intersection overlap');

console.log('Traffic vehicle checks passed');
