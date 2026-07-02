#!/usr/bin/env node
// Targeted unit test (M1.2): queue-slot targets must be produced in the world
// coordinate frame — for every synthetic building fixture, every generated
// queue-slot target must fall inside that building's world bbox (+margin).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LIVE_ACTION_API_TILE,
  buildingContainsApiPoint,
  serverScriptedServiceQueueSlotTarget,
} from '../src/realtime/agent-runtime-room.mjs';

const dataDir = mkdtempSync(join(tmpdir(), 'vw-queue-coords-'));
mkdirSync(join(dataDir, 'buildings'), { recursive: true });

function makeBuilding({ id, worldX, worldY, rotation = 0, queueSpots }) {
  return {
    id,
    type: 'office',
    worldX,
    worldY,
    widthTiles: 25,
    heightTiles: 17,
    _rotation: rotation,
    interior: {
      furniture: [
        {
          type: 'armchair',
          x: 12,
          z: 8,
          rotation: 0,
          floor: 1,
          room: 'lounge',
          queue: true,
          serviceQueue: true,
          queueLocations: queueSpots,
        },
      ],
    },
  };
}

const fixtures = [
  // Offset-style authored queue spots (dx/dz relative to furniture) — 8590 style.
  makeBuilding({
    id: 'bld-offset',
    worldX: 10,
    worldY: -5,
    queueSpots: [
      { dx: 0, dz: 1.2, queueIndex: 0 },
      { dx: 0, dz: 2.4, queueIndex: 1 },
      { dx: 0, dz: 3.6, queueIndex: 2 },
    ],
  }),
  // Interior-local raw x/z spots that previously leaked into world space unscaled
  // (permi symptom: target ~(1492,-1036) vs world ~(500,-28)).
  makeBuilding({
    id: 'bld-local-leak',
    worldX: 2,
    worldY: -3,
    queueSpots: [
      { x: 37, z: -26, queueIndex: 0 },
      { x: 40, z: -29, queueIndex: 1 },
    ],
  }),
  // Rotated building: transform must respect building rotation like the desk path.
  makeBuilding({
    id: 'bld-rotated',
    worldX: 40,
    worldY: 20,
    rotation: 90,
    queueSpots: [
      { dx: 1.0, dz: 0.8, queueIndex: 0 },
      { dx: 1.0, dz: 1.6, queueIndex: 1 },
    ],
  }),
];

for (const building of fixtures) {
  writeFileSync(join(dataDir, 'buildings', `${building.id}.json`), JSON.stringify(building, null, 2));
}

const MARGIN_API = 1 * LIVE_ACTION_API_TILE; // +1 tile margin

function bboxContains(building, x, y, margin = MARGIN_API) {
  if (buildingContainsApiPoint(building, x, y)) return true;
  // margin fallback: check bbox in world units for un-rotated frame comparison
  return buildingContainsApiPoint(building, x - margin, y) ||
    buildingContainsApiPoint(building, x + margin, y) ||
    buildingContainsApiPoint(building, x, y - margin) ||
    buildingContainsApiPoint(building, x, y + margin);
}

let checked = 0;
for (const building of fixtures) {
  const furniture = building.interior.furniture[0];
  const queueSpots = furniture.queueLocations;
  for (const spot of queueSpots) {
    const queueIndex = spot.queueIndex;
    const queueTarget = {
      buildingId: building.id,
      furnitureIndex: 0,
      objectType: furniture.type,
      objectKey: `object:${building.id}:0:${furniture.type}`,
      baseObjectKey: `object:${building.id}:0:${furniture.type}`,
      queueSpotId: 'queue',
      spotId: 'queue',
      isQueueUse: true,
      floor: 1,
      stayMs: 7000,
    };
    const reservation = {
      id: `queue:test:${building.id}:${queueIndex}`,
      state: 'queued',
      agentId: `agent-${queueIndex}`,
      queueSpotId: 'queue',
      queueIndex,
      slotId: `queue:${queueIndex}`,
      actionId: 'planning.schedule',
    };
    const slotTarget = serverScriptedServiceQueueSlotTarget(dataDir, queueTarget, reservation);
    assert.ok(slotTarget, `${building.id} queueIndex=${queueIndex}: slot target must resolve`);
    const x = Number(slotTarget.x);
    const y = Number(slotTarget.y);
    assert.ok(Number.isFinite(x) && Number.isFinite(y), `${building.id} queueIndex=${queueIndex}: coords finite`);
    assert.ok(
      bboxContains(building, x, y),
      `${building.id} queueIndex=${queueIndex}: target (${x.toFixed(1)},${y.toFixed(1)}) must be inside building world bbox (+margin)`,
    );
    checked++;
  }
}

assert.ok(checked >= 7, `expected at least 7 queue slots checked, got ${checked}`);
console.log(`verify-queue-slot-coords: OK (${checked} queue-slot targets inside building world bboxes)`);
