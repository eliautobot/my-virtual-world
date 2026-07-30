#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  getAnimationForAction,
  resolveAgentAnimationState,
} from '../src/client/js/agent-life-animation-registry.mjs';
import {
  listScriptedObjectRuntimeTargets,
  resolveScriptedObjectRuntimeTargetFromRequest,
  serverScriptedServiceQueueSlotTarget,
} from '../src/realtime/agent-runtime-room.mjs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [mainSource, characterSource, indexSource, realtimeSource] = await Promise.all([
  readFile(new URL('../src/client/js/main3d.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/client/js/agent-characters.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/client/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/realtime/agent-runtime-room.mjs', import.meta.url), 'utf8'),
]);

const catalogObject = getObjectCatalogExample('dumbbellRack');
assert.ok(catalogObject, 'dumbbellRack must exist in the object catalog schema');
const catalogValidation = validateObjectCatalogDefinition(catalogObject);
assert.equal(catalogValidation.valid, true, `dumbbellRack catalog schema must validate: ${catalogValidation.errors.join('; ')}`);
assert.deepEqual(
  catalogObject.apiActions.map(action => action.id),
  ['training.dumbbellCurls', 'training.dumbbellShoulderPress', 'training.dumbbellShoulderFlys'],
  'catalog must expose all three paired-dumbbell workouts',
);
assert.equal(catalogObject.lifecycle.transientHandVisual.count, 2, 'workout must declare one transient dumbbell per hand');
assert.equal(catalogObject.lifecycle.transientHandVisual.removeOnCompletion, true, 'hand dumbbells must be removed after the workout');

const registryEntry = resolveCatalogEntryForPlacedInstance({ type: 'dumbbellRack' }, CATALOG_REGISTRY);
assert.ok(registryEntry, 'dumbbellRack must resolve through the catalog registry');
assert.equal(registryEntry.interactionSpots.find(spot => spot.id === 'use-front')?.capacityKind, 'exclusive');
const queueSpot = registryEntry.interactionSpots.find(spot => spot.id === 'queue');
assert.equal(queueSpot?.capacityKind, 'queue');
assert.equal(queueSpot?.capacity, 3);
assert.equal(queueSpot?.serviceQueue, true);
assert.equal(queueSpot?.queueSpacingTiles, 1.25, 'rack queue spacing must clear the paired-dumbbell workout envelope');

const locations = getActionLocationsForAsset('dumbbellRack', { registry: ACTION_LOCATION_REGISTRY });
assert.ok(locations.some(location => location.id === 'use-front' && location.capacity.kind === 'exclusive'));
assert.ok(locations.some(location => location.id === 'queue' && location.capacity.kind === 'queue' && location.capacity.maxAgents === 3));

for (const actionId of ['training.dumbbellCurls', 'training.dumbbellShoulderPress', 'training.dumbbellShoulderFlys']) {
  assert.equal(getAnimationForAction(actionId)?.id, 'dumbbell-workout', `${actionId} must resolve to the paired workout animation`);
}
assert.equal(resolveAgentAnimationState({
  runtimeFlags: ['agent._idleActivity.kind=dumbbell-rack-*'],
  assetId: 'dumbbellRack',
  actionId: 'training.dumbbellShoulderPress',
  capabilityTags: ['training.practice'],
})?.animationId, 'dumbbell-workout');

const runtimeDataDir = await mkdtemp(join(tmpdir(), 'vw-dumbbell-rack-'));
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
      type: 'dumbbellRack',
      x: 8,
      z: 8,
      floor: 1,
      dumbbellRackColors: { weights: '#7c2d12', handles: '#facc15' },
      actionLocations: [
        { id: 'use-front', spotId: 'use-front', slotId: 'dumbbell-1', actionId: 'training.dumbbellCurls', roles: ['use', 'exercise', 'standing-use'], capacityKind: 'exclusive', capacity: 1, offset: { x: 0, z: 0.82 } },
        { id: 'queue', spotId: 'queue', actionId: 'planning.schedule', roles: ['queue', 'approach'], capacityKind: 'queue', capacity: 3, queueMaxPoints: 3, queueSpacingTiles: 1.25, serviceQueue: true, offset: { x: 0, z: 2.07 } },
      ],
    }],
  },
}, null, 2));
const runtimeTargets = listScriptedObjectRuntimeTargets(runtimeDataDir);
const runtimeUseTarget = runtimeTargets.find(target => target.objectType === 'dumbbellRack' && !target.isQueueUse);
const runtimeQueueTarget = runtimeTargets.find(target => target.objectType === 'dumbbellRack' && target.isQueueUse);
assert.equal(runtimeUseTarget?.spotId, 'use-front');
assert.equal(runtimeUseTarget?.activityKind, 'dumbbell-rack-arm-curls');
assert.equal(runtimeUseTarget?.animationId, 'dumbbell-workout');
assert.equal(runtimeUseTarget?.pairedDumbbells, true);
assert.equal(runtimeUseTarget?.dumbbellColors?.weights, '#7c2d12');
assert.equal(runtimeQueueTarget?.isQueueUse, true);
const queue0Target = serverScriptedServiceQueueSlotTarget(runtimeDataDir, runtimeQueueTarget, {
  agentId: 'queue-a',
  actionId: 'training.dumbbellCurls',
  queueSpotId: 'queue',
  queueIndex: 0,
});
const queue1Target = serverScriptedServiceQueueSlotTarget(runtimeDataDir, runtimeQueueTarget, {
  agentId: 'queue-b',
  actionId: 'training.dumbbellShoulderPress',
  queueSpotId: 'queue',
  queueIndex: 1,
});
const queue2Target = serverScriptedServiceQueueSlotTarget(runtimeDataDir, runtimeQueueTarget, {
  agentId: 'queue-c',
  actionId: 'training.dumbbellShoulderFlys',
  queueSpotId: 'queue',
  queueIndex: 2,
});
assert.equal(Math.round(Math.hypot(queue0Target.x - runtimeUseTarget.x, queue0Target.y - runtimeUseTarget.y)), 50, 'first queue point must be 1.25 tiles from use-front');
assert.equal(Math.round(Math.hypot(queue1Target.x - queue0Target.x, queue1Target.y - queue0Target.y)), 50, 'queue points must retain exact 1.25-tile FIFO spacing');
assert.equal(Math.round(Math.hypot(queue2Target.x - queue1Target.x, queue2Target.y - queue1Target.y)), 50, 'third queue point must retain exact 1.25-tile FIFO spacing');
assert.deepEqual(
  [queue0Target, queue1Target, queue2Target].map(target => target.slotId),
  ['queue:0', 'queue:1', 'queue:2'],
  'manual arrivals must resolve to queue points 1, 2, and 3 in FIFO order',
);
const shoulderPressTarget = resolveScriptedObjectRuntimeTargetFromRequest(runtimeDataDir, {
  buildingId: 'gym',
  furnitureIndex: 0,
  target: {
    ...runtimeUseTarget,
    actionId: 'training.dumbbellShoulderPress',
    activityKind: 'dumbbell-rack-shoulder-press',
    animationId: 'dumbbell-workout',
    workoutMode: 'shoulderPress',
    pairedDumbbells: true,
  },
});
assert.equal(shoulderPressTarget?.actionId, 'training.dumbbellShoulderPress');
assert.equal(shoulderPressTarget?.activityKind, 'dumbbell-rack-shoulder-press');
assert.equal(shoulderPressTarget?.workoutMode, 'shoulderPress');
const legacyFalseWorkoutTarget = resolveScriptedObjectRuntimeTargetFromRequest(runtimeDataDir, {
  buildingId: 'gym',
  furnitureIndex: 0,
  target: {
    ...runtimeUseTarget,
    actionId: 'training.dumbbellCurls',
    activityKind: 'dumbbell-rack-arm-curls',
    pairedDumbbells: false,
  },
});
assert.equal(
  legacyFalseWorkoutTarget?.pairedDumbbells,
  true,
  'active dumbbell workouts must restore both hand weights even when a stale client sends false',
);

for (const marker of [
  "dumbbellAxis: 'z'",
  "id: 'pair-light'",
  "id: 'pair-medium'",
  "id: 'pair-heavy'",
  "id: 'pair-extra-heavy'",
  'DUMBBELL_WORKOUT_MODES',
  "dumbbellRack: Object.freeze({ lifecycle: 'standing', activationSpotId: 'use-front' })",
  'advanceScriptedServiceQueueAfterUse(rackBuilding',
  'moveAgentOffDumbbellRackUseFront(rack, rackActivity, agent)',
  'manualQueuePreservedFcfs',
  'runtime-world-object-active',
  'isScriptedServiceObjectClaimedForManualQueue(rack)',
  'startDraggedAgentServiceMachineViaFurnitureHandler',
  'normalFurnitureHandlerParity',
  'queuePointsClearWorkoutEnvelope',
  'isAgentRuntimeSnapshotCoveredByBackendObjectUseAdoption',
  'authoritativeQueueAdoptionSurvivesDuplicateAck',
  'resolveBackendPairedDumbbellsFlag',
  'dumbbellRackColors',
  '__verifyDumbbellRackWorkoutUpgrade',
]) {
  assert.ok(mainSource.includes(marker), `main3d.js is missing dumbbell rack contract marker: ${marker}`);
}
assert.ok(
  !mainSource.includes("addPart(posVox(0, 0.98 * s, -0.02 * s, 1.16 * s, 0.07 * s, 0.06 * s, handles), 'handles')"),
  'dumbbell rack must not render the decorative colored bar above the weights',
);
const manualQueueRequestSource = mainSource.slice(
  mainSource.indexOf('function requestBackendQueueUseForDraggedAgentDrop'),
  mainSource.indexOf('function startDraggedAgentMultiSeatUse'),
);
assert.ok(manualQueueRequestSource.length > 0, 'manual queue request function must remain present');
assert.ok(!manualQueueRequestSource.includes('insertQueueAtFront'), 'manual drops must append to the FCFS queue');
assert.ok(!manualQueueRequestSource.includes('queuePriority: -1'), 'manual drops must not receive priority over existing waiters');
assert.ok(
  manualQueueRequestSource.includes('queue:0/1/2 are runtime-assigned line positions'),
  'manual dumbbell drops must treat numbered queue points as server-assigned destinations',
);
assert.ok(
  manualQueueRequestSource.includes('requestBackendObjectUseForExplicitObjectAction(agent, canonicalUseTarget'),
  'manual dumbbell drops must request the canonical use-front target so realtime can atomically choose use or queue',
);
assert.ok(
  !manualQueueRequestSource.includes('requestBackendObjectUseForExplicitObjectAction(agent, queueTarget'),
  'manual dumbbell drops must never submit a locally guessed queue slot as an authored object target',
);
for (const marker of [
  "dumbbellrack: Object.freeze({ kind: 'dumbbell-rack-arm-curls', spotId: 'use-front'",
  'queuedUseWorkoutMode',
  'useWorkoutMode',
  "animationId = 'dumbbell-workout'",
  "normalizeObjectTypeKey(target.objectType) === 'dumbbellrack'",
  'server-owned world object cannot be overwritten by a browser runtime',
]) {
  assert.ok(realtimeSource.includes(marker), `realtime runtime is missing dumbbell workout marker: ${marker}`);
}

for (const marker of [
  'syncDumbbellWorkoutVisual(parts, agent)',
  "getObjectByName('leftHandDumbbell')",
  "getObjectByName('rightHandDumbbell')",
  'isDumbbellArmCurls',
  'isDumbbellShoulderPress',
  'isDumbbellShoulderFlys',
  'isDumbbellRackUseFrontActivity',
]) {
  assert.ok(characterSource.includes(marker), `agent-characters.js is missing workout visual marker: ${marker}`);
}

assert.match(
  indexSource,
  /main3d\.js\?v=20260729-[^"]+/i,
  'index.html must cache-bust the current main3d runtime bundle',
);

console.log('Dumbbell rack asset, workouts, colors, authoritative three-point FCFS manual queue, immediate dismissal, and no-top-bar contracts verified.');
