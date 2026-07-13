#!/usr/bin/env node
// Regression test: server runtime floor changes must go through the elevator.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServerRuntimeStep } from '../src/realtime/agent-runtime-room.mjs';

const API_TILE = 40;
const api = (value) => value * API_TILE;

const dataDir = mkdtempSync(join(tmpdir(), 'vw-floor-elevator-'));
mkdirSync(join(dataDir, 'buildings'), { recursive: true });

writeFileSync(join(dataDir, 'buildings', 'tower.json'), JSON.stringify({
  id: 'tower',
  type: 'office',
  worldX: 0,
  worldY: 0,
  widthTiles: 10,
  heightTiles: 8,
  floorCount: 2,
  floors: [
    { level: 1, name: 'Floor 1' },
    { level: 2, name: 'Floor 2' },
  ],
  elevator: { x: 2.5, z: 3.5, width: 2.8, depth: 2.8 },
  interior: {
    walls: [
      { x1: 4.6, z1: 1, x2: 4.6, z2: 7, floor: 1 },
      { x1: 7.4, z1: 1, x2: 7.4, z2: 7, floor: 2 },
    ],
    furniture: [
      { id: 'downstairs-desk', type: 'desk', x: 6, z: 3, floor: 1 },
      { id: 'upstairs-desk', type: 'desk', x: 6, z: 5, floor: 2 },
    ],
  },
}, null, 2));

const upstairsTarget = {
  x: api(6),
  y: api(5),
  floor: 2,
  buildingId: 'tower',
  targetKind: 'work-desk',
  objectKey: 'tower:furniture:1:desk',
};

const outsideStep = makeServerRuntimeStep(dataDir, 'outside-agent', {
  x: api(5),
  y: api(9.6),
  floor: 2,
  state: 'routing',
  heading: 0,
}, upstairsTarget, 100, {
  speedUnitsPerSec: 80,
  arrivalRadius: 5,
  crowdAgents: [],
});
assert.equal(outsideStep.floor, 1, 'outside agents must remain on floor 1 while approaching an upstairs target');
assert.equal(outsideStep.steeringTarget?.floor, 1, 'building entry should target floor 1 first');
assert.equal(outsideStep.route?.doorFinalTarget?.floor, 2, 'door handoff should preserve the original upstairs target');

const firstFloorElevatorStep = makeServerRuntimeStep(dataDir, 'first-floor-agent', {
  x: api(4),
  y: api(4),
  floor: 1,
  buildingId: 'tower',
  state: 'routing',
  heading: 0,
}, upstairsTarget, 100, {
  speedUnitsPerSec: 80,
  arrivalRadius: 5,
  crowdAgents: [],
});
assert.equal(firstFloorElevatorStep.floor, 1, 'agent should stay on floor 1 while routing to the elevator');
assert.equal(firstFloorElevatorStep.route?.elevatorTrip?.toFloor, 2, 'same-building upper-floor target should start an elevator trip');
assert.match(firstFloorElevatorStep.phase, /^elevator-/, 'same-building floor change should use an elevator phase');

const elevatorRideStep = makeServerRuntimeStep(dataDir, 'rider-agent', {
  x: api(2.08),
  y: api(3.5),
  floor: 1,
  buildingId: 'tower',
  state: 'routing',
  heading: 0,
  visualState: { runtimeRoute: firstFloorElevatorStep.route },
}, upstairsTarget, 100, {
  speedUnitsPerSec: 80,
  arrivalRadius: 5,
  crowdAgents: [],
});
assert.equal(elevatorRideStep.floor, 2, 'elevator arrival should switch the current floor to the destination floor');
assert.equal(elevatorRideStep.buildingId, 'tower', 'elevator exit should remain inside the same building');
assert.equal(elevatorRideStep.arrived, false, 'elevator arrival is a handoff, not final target arrival');
assert.equal(elevatorRideStep.route?.elevatorTrip?.state, 'arrived', 'elevator route should record the handoff completion');

const upstairsRouteStep = makeServerRuntimeStep(dataDir, 'upstairs-agent', {
  x: elevatorRideStep.x,
  y: elevatorRideStep.y,
  floor: elevatorRideStep.floor,
  buildingId: 'tower',
  state: 'routing',
  heading: elevatorRideStep.heading,
  visualState: { runtimeRoute: elevatorRideStep.route },
}, upstairsTarget, 100, {
  speedUnitsPerSec: 80,
  arrivalRadius: 5,
  crowdAgents: [],
});
assert.equal(upstairsRouteStep.floor, 2, 'post-elevator interior routing should stay on floor 2');
assert.equal(Boolean(upstairsRouteStep.route?.elevatorTrip), false, 'post-elevator routing should resume normal interior movement');
assert.equal(upstairsRouteStep.route?.source, 'dynamic-interior-routing.js');

const floorTwoExitStep = makeServerRuntimeStep(dataDir, 'exit-agent', {
  x: api(6),
  y: api(5),
  floor: 2,
  buildingId: 'tower',
  state: 'routing',
  heading: 0,
}, {
  x: api(12),
  y: api(10),
  floor: 1,
  targetKind: 'world-point',
}, 100, {
  speedUnitsPerSec: 80,
  arrivalRadius: 5,
  crowdAgents: [],
});
assert.equal(floorTwoExitStep.floor, 2, 'floor-2 exits should first route to the elevator on floor 2');
assert.equal(floorTwoExitStep.route?.elevatorTrip?.toFloor, 1, 'floor-2 exits should ride down before using the exterior door');

console.log('verify-server-runtime-floor-elevator: OK');
