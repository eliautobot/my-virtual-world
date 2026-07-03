#!/usr/bin/env node
// Regression test: stale persisted door specs must not send agents through
// a phantom interior waypoint far from the real front door.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServerRuntimeStep } from '../src/realtime/agent-runtime-room.mjs';

const dataDir = mkdtempSync(join(tmpdir(), 'vw-door-spec-'));
mkdirSync(join(dataDir, 'buildings'), { recursive: true });

writeFileSync(join(dataDir, 'buildings', 'office.json'), JSON.stringify({
  id: 'office',
  type: 'office',
  worldX: 0,
  worldY: -13,
  widthTiles: 30,
  heightTiles: 22,
  doorSpec: {
    localCenterX: 12.5,
    localThresholdZ: 23.5,
    localOutsideZ: 23.5,
    localInteriorZ: 11.8,
    localDoorwayZ: 11.95,
    doorwayReachWorld: 0.528,
    openingWidth: 2.4,
    wallThickness: 0.25,
  },
  interior: { furniture: [], walls: [] },
}, null, 2));

const current = {
  x: 2.8 * 40,
  y: -8.5 * 40,
  floor: 1,
  buildingId: 'office',
  heading: 0,
  state: 'routing',
};
const target = {
  x: 49 * 40,
  y: 18 * 40,
  floor: 1,
  targetKind: 'world-point',
};

const step = makeServerRuntimeStep(dataDir, 'coder', current, target, 100, {
  speedUnitsPerSec: 72,
  arrivalRadius: 5,
  crowdAgents: [],
});

const points = step.route?.routePoints || [];
const next = points[1] || null;
assert.equal(step.phase, 'door-inside-approach');
assert.equal(step.route?.source, 'dynamic-interior-routing.js');
assert.equal(step.route?.phase, 'door-inside-approach');
assert.equal(step.route?.doorBuildingId, 'office');
assert.ok(step.route?.doorFinalTarget, `door approach route should carry door metadata for client door animation: ${JSON.stringify(step.route)}`);
assert.ok(next, 'door approach should include the repaired doorway threshold point');
assert.ok(
  next.y / 40 > 7,
  `inside door point should be near the front door, not the stale phantom point: ${JSON.stringify(next)}`,
);
assert.ok(
  Math.abs(next.x / 40 - 15) < 0.05 && Math.abs(next.y / 40 - 8.55) < 0.05,
  `doorway threshold should be repaired to the front-center door, not a stale off-center point: ${JSON.stringify(next)}`,
);
assert.ok(
  points.every((point, index) => index === 0 || Math.abs(point.y / 40 + 1.2) > 0.25),
  `route should not preserve stale phantom door point near grid y=-1.2: ${JSON.stringify(points)}`,
);
assert.ok(
  points.every((point, index) => index === 0 || Math.abs(point.x / 40 - 12.5) > 0.25),
  `route should not preserve stale off-center door point near grid x=12.5: ${JSON.stringify(points)}`,
);

const crossing = makeServerRuntimeStep(dataDir, 'coder', {
  x: 15 * 40,
  y: 8.55 * 40,
  floor: 1,
  buildingId: 'office',
  heading: 0,
  state: 'routing',
}, target, 100, {
  speedUnitsPerSec: 3000,
  arrivalRadius: 5,
  crowdAgents: [],
});
const crossingPoints = crossing.route?.routePoints || [];
const outside = crossingPoints[crossingPoints.length - 1] || null;
assert.equal(crossing.route?.source, 'server-door-transition');
assert.equal(crossing.route?.reason, 'exit-building-through-door');
assert.equal(crossing.route?.phase, 'door-exit');
assert.equal(crossing.route?.doorBuildingId, 'office');
assert.equal(crossing.route?.active, true);
assert.ok(
  outside && Math.abs(outside.x / 40 - 15) < 0.05 && Math.abs(outside.y / 40 - 9.2) < 0.05,
  `door crossing should use the repaired outside door landing: ${JSON.stringify(crossing.route)}`,
);
assert.ok(
  crossing.y / 40 > 9,
  `near-door exit should cross through the doorway instead of staying inside: ${JSON.stringify(crossing)}`,
);

let slowExitCurrent = {
  x: 15 * 40,
  y: 8.55 * 40,
  floor: 1,
  buildingId: 'office',
  heading: 0,
  state: 'routing',
};
let slowExit = null;
for (let i = 0; i < 12; i++) {
  slowExit = makeServerRuntimeStep(dataDir, 'slow-door-exit', slowExitCurrent, target, 100, {
    speedUnitsPerSec: 72,
    arrivalRadius: 5,
    crowdAgents: [],
  });
  slowExitCurrent = {
    ...slowExitCurrent,
    x: slowExit.x,
    y: slowExit.y,
    heading: slowExit.heading,
    state: 'routing',
    visualState: { runtimeRoute: slowExit.route },
  };
  if (slowExit.y / 40 > 9) break;
}
assert.ok(
  slowExit && slowExit.y / 40 > 9,
  `normal-speed door exit should keep progressing through the doorway corridor instead of sticking on partial wall ticks: ${JSON.stringify(slowExit)}`,
);
assert.doesNotMatch(
  slowExit?.route?.blockedReason || '',
  /server-static-step-(end|reduced)-blocked/,
  `normal-speed door exit must not be trapped by same-building interior wall validation: ${JSON.stringify(slowExit?.route)}`,
);

console.log('verify-door-spec-route-repair: OK');
