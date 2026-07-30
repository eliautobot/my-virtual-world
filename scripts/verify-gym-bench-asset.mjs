#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getObjectCatalogExample,
  validateObjectCatalogDefinition,
} from '../src/client/js/agent-life-object-catalog-schema.mjs';
import {
  CATALOG_REGISTRY,
  resolveCatalogEntryForPlacedInstance,
} from '../src/client/js/agent-life-catalog-registry.mjs';
import {
  ACTION_LOCATION_REGISTRY,
  getActionLocationsForAsset,
} from '../src/client/js/agent-life-action-location-registry.mjs';
import {
  isServerManualObjectOccupancyTarget,
  listScriptedObjectRuntimeTargets,
  resolveScriptedObjectRuntimeTargetFromRequest,
  serverScriptedServiceQueueSlotTarget,
} from '../src/realtime/agent-runtime-room.mjs';

const [mainSource, characterSource, realtimeSource, indexSource] = await Promise.all([
  readFile(new URL('../src/client/js/main3d.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/client/js/agent-characters.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/realtime/agent-runtime-room.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../src/client/index.html', import.meta.url), 'utf8'),
]);

const catalogObject = getObjectCatalogExample('gymBench');
assert.ok(catalogObject, 'gymBench must exist in the object catalog schema');
const validation = validateObjectCatalogDefinition(catalogObject);
assert.equal(validation.valid, true, `gymBench catalog schema must validate: ${validation.errors.join('; ')}`);
assert.equal(catalogObject.capacity.concurrentUsers, 1);
assert.equal(catalogObject.capacity.queue, 3);
assert.equal(catalogObject.lifecycle.transientHandVisual.count, 2);
assert.equal(catalogObject.lifecycle.transientHandVisual.exerciseOnly, true);

const registryEntry = resolveCatalogEntryForPlacedInstance({ type: 'gymBench' }, CATALOG_REGISTRY);
assert.ok(registryEntry, 'gymBench must resolve through the catalog registry');
assert.equal(registryEntry.interactionSpots.find(spot => spot.id === 'bench-use')?.capacityKind, 'exclusive');
const registryQueue = registryEntry.interactionSpots.find(spot => spot.id === 'queue');
assert.equal(registryQueue?.capacity, 3);
assert.equal(registryQueue?.serviceQueue, true);
assert.equal(registryQueue?.queueSpacingTiles, 1.25);

const locations = getActionLocationsForAsset('gymBench', { registry: ACTION_LOCATION_REGISTRY });
assert.ok(locations.some(location => location.id === 'bench-use' && location.capacity.kind === 'exclusive'));
assert.ok(locations.some(location => location.id === 'queue' && location.capacity.kind === 'queue' && location.capacity.maxAgents === 3));

const runtimeDataDir = await mkdtemp(join(tmpdir(), 'vw-gym-bench-'));
await mkdir(join(runtimeDataDir, 'buildings'), { recursive: true });
await writeFile(join(runtimeDataDir, 'buildings', 'gym.json'), JSON.stringify({
  id: 'gym',
  type: 'office',
  worldX: 0,
  worldY: 0,
  widthTiles: 20,
  heightTiles: 20,
  interior: {
    furniture: [{
      id: 'saved-bench-before-queue-schema',
      type: 'gymBench',
      x: 8,
      z: 8,
      floor: 1,
      gymBenchColors: { weights: '#7c3aed', handles: '#fde047' },
      actionLocations: [
        {
          id: 'approach-front',
          spotId: 'approach-front',
          actionId: 'training.approachGymBench',
          roles: ['approach', 'staging'],
          capacity: { kind: 'staging', maxAgents: 1, reservable: false },
          offset: { x: 0, z: 1.48 },
        },
        { id: 'bench-use', spotId: 'bench-use', slotId: 'bench-use', actionId: 'training.useGymBench', roles: ['use', 'exercise', 'seat', 'lie'], capacityKind: 'exclusive', capacity: 1, offset: { x: 0, z: 0.04 } },
      ],
    }, {
      id: 'saved-bench-with-queue-before-spacing-schema',
      type: 'gymBench',
      x: 12,
      z: 8,
      floor: 1,
      actionLocations: [
        {
          id: 'approach-front',
          spotId: 'approach-front',
          actionId: 'training.approachGymBench',
          roles: ['approach', 'staging'],
          capacity: { kind: 'staging', maxAgents: 1, reservable: false },
          actionTarget: { x: 12, z: 9.48, floor: 1, faceAngle: Math.PI },
        },
        {
          id: 'bench-use',
          spotId: 'bench-use',
          actionId: 'training.useGymBench',
          roles: ['use', 'exercise', 'seat', 'lie'],
          capacity: { kind: 'exclusive', maxAgents: 1, reservable: true },
          actionTarget: { x: 12, z: 8.04, floor: 1, faceAngle: Math.PI },
        },
        {
          id: 'queue',
          spotId: 'queue',
          actionId: 'planning.schedule',
          roles: ['approach', 'queue'],
          capacity: { kind: 'queue', maxAgents: 3, reservable: true },
          actionTarget: { x: 12, z: 9.29, floor: 1, faceAngle: Math.PI },
        },
      ],
    }],
  },
}, null, 2));

const runtimeTargets = listScriptedObjectRuntimeTargets(runtimeDataDir);
const useTarget = runtimeTargets.find(target => target.objectType === 'gymBench' && !target.isQueueUse && target.spotId === 'bench-use');
const queueTarget = runtimeTargets.find(target => target.objectType === 'gymBench' && target.isQueueUse);
assert.ok(useTarget, 'saved gym bench must expose bench-use');
assert.ok(queueTarget, 'saved pre-queue gym bench must receive a synthetic realtime queue');
assert.equal(queueTarget.spotId, 'queue', 'approach-front staging must never become the service queue');
assert.equal(useTarget.poseKind, 'seat');
assert.equal(useTarget.activityKind, 'gym-bench-exercise');
assert.equal(useTarget.animationId, 'gym-bench-exercise');
assert.equal(useTarget.pairedDumbbells, true);
assert.equal(useTarget.dumbbellColors?.weights, '#7c3aed');
assert.equal(useTarget.dumbbellColors?.handles, '#fde047');

const queueSlots = [0, 1, 2].map(queueIndex => serverScriptedServiceQueueSlotTarget(runtimeDataDir, queueTarget, {
  agentId: `queue-${queueIndex}`,
  actionId: 'planning.schedule',
  queueSpotId: 'queue',
  queueIndex,
}));
assert.deepEqual(queueSlots.map(target => target.slotId), ['queue:0', 'queue:1', 'queue:2']);
assert.equal(Math.round(Math.hypot(queueSlots[0].x - useTarget.x, queueSlots[0].y - useTarget.y)), 50);
assert.equal(Math.round(Math.hypot(queueSlots[1].x - queueSlots[0].x, queueSlots[1].y - queueSlots[0].y)), 50);
assert.equal(Math.round(Math.hypot(queueSlots[2].x - queueSlots[1].x, queueSlots[2].y - queueSlots[1].y)), 50);
assert.ok(queueSlots.every(target => target.pairedDumbbells === false), 'queue waiters must never display workout weights');

const savedSpacingUseTarget = runtimeTargets.find(target =>
  target.objectType === 'gymBench' &&
  target.furnitureIndex === 1 &&
  !target.isQueueUse &&
  target.spotId === 'bench-use');
const savedSpacingQueueTarget = runtimeTargets.find(target =>
  target.objectType === 'gymBench' &&
  target.furnitureIndex === 1 &&
  target.isQueueUse &&
  target.spotId === 'queue');
assert.ok(savedSpacingUseTarget, 'saved gym bench with an old queue must expose bench-use');
assert.ok(savedSpacingQueueTarget, 'saved gym bench with an old queue must retain its queue anchor');
const savedSpacingSlots = [0, 1, 2].map(queueIndex => serverScriptedServiceQueueSlotTarget(runtimeDataDir, savedSpacingQueueTarget, {
  agentId: `saved-spacing-${queueIndex}`,
  actionId: 'planning.schedule',
  queueSpotId: 'queue',
  queueIndex,
}));
assert.deepEqual([
  Math.round(Math.hypot(savedSpacingSlots[0].x - savedSpacingUseTarget.x, savedSpacingSlots[0].y - savedSpacingUseTarget.y)),
  Math.round(Math.hypot(savedSpacingSlots[1].x - savedSpacingSlots[0].x, savedSpacingSlots[1].y - savedSpacingSlots[0].y)),
  Math.round(Math.hypot(savedSpacingSlots[2].x - savedSpacingSlots[1].x, savedSpacingSlots[2].y - savedSpacingSlots[1].y)),
], [50, 50, 50], 'saved gym bench queues must receive the current visible spacing without rewriting world data');

const exerciseTarget = resolveScriptedObjectRuntimeTargetFromRequest(runtimeDataDir, {
  target: {
    ...useTarget,
    actionId: 'training.useGymBench',
    activityKind: 'gym-bench-exercise',
    pairedDumbbells: true,
    stayMs: 300000,
  },
});
assert.equal(exerciseTarget?.activityKind, 'gym-bench-exercise');
assert.equal(exerciseTarget?.pairedDumbbells, true);
assert.equal(exerciseTarget?.dumbbellColors?.weights, '#7c3aed');
assert.equal(exerciseTarget?.stayMs, 13000, 'manual bench use must be capped at thirteen seconds');
assert.equal(isServerManualObjectOccupancyTarget(exerciseTarget, {
  manualDrop: true,
  source: 'manual-drag-drop',
}), false, 'gym bench workouts must not inherit the five-minute seat occupancy hold');
const exerciseTargetFromLegacyFalse = resolveScriptedObjectRuntimeTargetFromRequest(runtimeDataDir, {
  target: {
    ...useTarget,
    actionId: 'training.useGymBench',
    activityKind: 'gym-bench-exercise',
    pairedDumbbells: false,
  },
});
assert.equal(
  exerciseTargetFromLegacyFalse?.pairedDumbbells,
  true,
  'active bench workouts must restore paired hand weights even when a stale client sends false',
);

const restTarget = resolveScriptedObjectRuntimeTargetFromRequest(runtimeDataDir, {
  target: {
    ...useTarget,
    actionId: 'life.restOnGymBench',
    activityKind: 'gym-bench-rest',
    pairedDumbbells: false,
  },
});
assert.equal(restTarget?.activityKind, 'gym-bench-rest');
assert.equal(restTarget?.pairedDumbbells, false);
assert.equal(restTarget?.dumbbellColors, null);

for (const marker of [
  "gymBench: Object.freeze({ lifecycle: 'active', activationSpotId: 'bench-use'",
  "property: 'gymBenchColors'",
  'getGymBenchDumbbellColors',
  'moveAgentOffGymBenchUsePoint(bench, benchActivity, agent)',
  'advanceScriptedServiceQueueAfterUse(benchBuilding',
  'queueSpacingTiles: 1.25, serviceQueue: true',
  'countPendingBackendServiceQueueRequests',
  'anticipatedQueueIndex',
  'resolveBackendPairedDumbbellsFlag',
  "window._useGymBenchFurniture = (mode = 'exercise', preferredAgentId = null, options = {})",
  '__verifyGymBenchUpgrade',
]) {
  assert.ok(mainSource.includes(marker), `main3d.js missing gym bench contract marker: ${marker}`);
}
for (const marker of [
  'isGymBenchDumbbellUseActivity',
  'isDumbbellRackUseFrontActivity(activity) || isGymBenchDumbbellUseActivity(activity)',
  '!isGymBenchExercise && parts.leftArm.rotation.z',
  '-0.36 - press * 0.10',
  '0.36 + press * 0.10',
  '-0.82 - press * 0.60',
]) {
  assert.ok(characterSource.includes(marker), `agent-characters.js missing gym bench visual marker: ${marker}`);
}
for (const marker of [
  "gymbench: Object.freeze({ kind: 'gym-bench-exercise'",
  'Existing saved gym benches predate the queue schema',
  "normalizeObjectTypeKey(target?.objectType) === 'gymbench'",
  'promotedGymBenchExercise',
]) {
  assert.ok(realtimeSource.includes(marker), `realtime runtime missing gym bench marker: ${marker}`);
}
assert.match(indexSource, /main3d\.js\?v=20260729-[^"]+/i);

console.log('Gym bench colors, paired exercise weights, saved-world-safe three-point FIFO queue, promotion, and immediate dismissal contracts verified.');
