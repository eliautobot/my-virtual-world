#!/usr/bin/env node
// Regression test: cached server pathfinder routes must still obey the static
// segment guard before publishing authoritative positions.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentRuntimeRoom,
  MAX_VISUAL_STATE_JSON_CHARS,
  isServerScriptedObjectTargetAvailable,
  isLiveActionAgentTargetWithinInteractionRange,
  listScriptedObjectRuntimeTargets,
  makeLiveActionRuntimeMovement,
  makeServerScriptedDeskConsumeTarget,
  makeServerRuntimeStep,
  observeServerRuntimeRouteProgress,
  resolveActionTargetPoint,
  SERVER_RUNTIME_AGENT_HARD_SEPARATION_RADIUS,
  SERVER_RUNTIME_ROUTE_STALE_AFTER_MS,
  serverScriptedServiceQueueSlotTarget,
  snapshotToPlain,
  worldObjectToPlain,
} from '../src/realtime/agent-runtime-room.mjs';
import { configureDynamicExteriorRouting } from '../src/client/js/dynamic-exterior-routing.js';
import { configureDynamicInteriorRouting } from '../src/client/js/dynamic-interior-routing.js';

const dataDir = mkdtempSync(join(tmpdir(), 'vw-runtime-collision-'));
mkdirSync(join(dataDir, 'buildings'), { recursive: true });

writeFileSync(join(dataDir, 'buildings', 'office.json'), JSON.stringify({
  id: 'office',
  type: 'test-building',
  worldX: 0,
  worldY: 0,
  widthTiles: 10,
  heightTiles: 10,
  interior: {
    walls: [
      { x1: 3, z1: 0, x2: 3, z2: 6, floor: 1 },
    ],
    furniture: [],
  },
}, null, 2));

const api = (tile) => tile * 40;

// Live social actions route against the target resident's authoritative
// realtime coordinates. The route target intentionally omits catalogId so it
// cannot be misclassified as a furniture object.
{
  const targetState = {
    agents: new Map([[
      'social-peer',
      { agentId: 'social-peer', x: 240, y: 320, floor: 1, buildingId: 'office', roomId: 'lobby', heading: 0 },
    ]]),
  };
  const point = resolveActionTargetPoint(dataDir, {
    id: 'social-live-action',
    actionType: 'life.social',
    target: { kind: 'agent', targetAgentId: 'social-peer', catalogId: 'agent' },
    route: { target: { kind: 'agent', targetAgentId: 'social-peer', floor: 2, targetKind: 'agent' } },
  }, targetState);
  assert.equal(point?.targetKind, 'agent', `social route should resolve as an agent target: ${JSON.stringify(point)}`);
  assert.equal(point?.targetAgentId, 'social-peer', `social route should preserve target agent identity: ${JSON.stringify(point)}`);
  assert.equal(point?.x, 240, `social route should use authoritative target x: ${JSON.stringify(point)}`);
  assert.equal(point?.y, 296, `social route should approach behind the target heading: ${JSON.stringify(point)}`);
  assert.equal(point?.floor, 1, `social route should follow the authoritative target floor instead of a stale route hint: ${JSON.stringify(point)}`);
  assert.equal(point?.buildingId, 'office', `social route should use authoritative target building: ${JSON.stringify(point)}`);
}

// Social actions complete on embodied interaction proximity instead of trying
// to dock on the exact, continuously moving resident coordinate.
{
  const current = { x: 200, y: 240, floor: 1, buildingId: 'office', roomId: 'lobby', heading: 0 };
  const target = { x: 252, y: 240, floor: 1, buildingId: 'office', roomId: 'lobby', targetKind: 'agent', targetAgentId: 'social-peer' };
  assert.equal(isLiveActionAgentTargetWithinInteractionRange(current, target), true, 'two nearby residents should be within social interaction range');
  const movement = makeLiveActionRuntimeMovement(dataDir, 'social-actor', current, target, 100, { crowdAgents: [] });
  assert.equal(movement.arrived, true, 'nearby social target should arrive without exact coordinate docking');
  assert.equal(movement.x, current.x, 'social arrival must preserve the actor x instead of teleporting onto the target');
  assert.equal(movement.y, current.y, 'social arrival must preserve the actor y instead of teleporting onto the target');
  assert.equal(movement.route?.reason, 'agent-within-interaction-range', 'social arrival should expose its proximity reason');

  const otherFloor = { ...target, floor: 2 };
  assert.equal(isLiveActionAgentTargetWithinInteractionRange(current, otherFloor), false, 'social interaction cannot cross floors');
  const tooFar = { ...target, x: current.x + 81 };
  assert.equal(isLiveActionAgentTargetWithinInteractionRange(current, tooFar), false, 'social interaction cannot exceed the two-tile radius');
}

// Long routes remain healthy for any total duration while authoritative
// coordinates continue moving. A route only becomes stale after a full
// watchdog window without meaningful progress.
{
  const watchdog = new Map();
  const routeId = 'route-long-live-action';
  const actionId = 'long-live-action';
  const startMs = Date.now();
  const first = observeServerRuntimeRouteProgress(watchdog, actionId, {
    routeId,
    nowMs: startMs,
    x: 0,
    y: 0,
    distanceToFinal: 6000,
  });
  assert.equal(first.initialized, true, 'first authoritative route observation starts the progress watchdog');
  const afterLongTravel = observeServerRuntimeRouteProgress(watchdog, actionId, {
    routeId,
    nowMs: startMs + SERVER_RUNTIME_ROUTE_STALE_AFTER_MS + 5000,
    x: 3600,
    y: 0,
    distanceToFinal: 2400,
  });
  assert.equal(afterLongTravel.progressed, true, 'authoritative movement refreshes a route older than the stale window');
  assert.equal(afterLongTravel.stale, false, 'long advancing routes must not be failed by total trip duration');
  const actuallyStalled = observeServerRuntimeRouteProgress(watchdog, actionId, {
    routeId,
    nowMs: startMs + (SERVER_RUNTIME_ROUTE_STALE_AFTER_MS * 2) + 5001,
    x: 3600,
    y: 0,
    distanceToFinal: 2400,
  });
  assert.equal(actuallyStalled.stale, true, 'a route with no coordinate progress for the full watchdog window must fail');
}

function makeFakeRuntimeRoom(dataDirForRoom) {
  const room = Object.create(AgentRuntimeRoom.prototype);
  room.dataDir = dataDirForRoom;
  room.state = { agents: new Map(), objects: new Map(), updatedAt: '' };
  room.events = [];
  room.worldRuntimeTickContext = null;
  room.serverRuntimeBlockerYieldCooldowns = new Map();
  room.scriptedObjectRuntimeMemory = new Map();
  room.scriptedObjectRuntimeNextPulseAtMs = new Map();
  room.scriptedObjectRuntimeCooldowns = new Map();
  room.liveActionRouteWatchdog = new Map();
  room.recordEvent = () => ({});
  room.persistRuntimeDocument = () => {};
  room.broadcastRuntimeState = () => {};
  return room;
}

// The realtime writer must merge against a fresh shared world-action store.
// A just-created Python action can arrive inside the normal 250 ms hot-cache
// window and must not be erased by a stale runtime tick write.
{
  const mergeDataDir = mkdtempSync(join(tmpdir(), 'vw-runtime-fresh-merge-'));
  const metaPath = join(mergeDataDir, 'world-meta.json');
  const oldAction = { id: 'old-action', agentId: 'old-agent', status: 'routing' };
  const newAction = { id: 'new-python-action', agentId: 'new-agent', status: 'reserved' };
  writeFileSync(metaPath, JSON.stringify({ agentLife: { worldActions: { active: [oldAction], history: [] } } }, null, 2));
  const mergeRoom = makeFakeRuntimeRoom(mergeDataDir);
  const stale = mergeRoom.loadLiveActionRuntimeStore(1000);
  writeFileSync(metaPath, JSON.stringify({ agentLife: { worldActions: { active: [oldAction, newAction], history: [] } } }, null, 2));
  mergeRoom.saveLiveActionRuntimeStore(stale.meta, stale.store, 1001);
  const savedActions = JSON.parse(readFileSync(metaPath, 'utf8')).agentLife.worldActions.active;
  assert.ok(savedActions.some(action => action.id === newAction.id), `fresh runtime merge must preserve a just-created action: ${JSON.stringify(savedActions)}`);
}
configureDynamicInteriorRouting({
  apiToWorldScale: 1 / 40,
  getInteriorBuildingAt: (apiX, apiY) => {
    const x = Number(apiX) / 40;
    const z = Number(apiY) / 40;
    return x >= 0 && x <= 10 && z >= 0 && z <= 10
      ? { id: 'office', type: 'test-building', worldX: 0, worldY: 0, widthTiles: 10, heightTiles: 10, interior: { walls: [{ x1: 3, z1: 0, x2: 3, z2: 6, floor: 1 }], furniture: [] } }
      : null;
  },
});
const finalTarget = { x: api(5), y: api(2), floor: 1, buildingId: 'office' };
const wallCutRoutePoints = [
  { x: api(2), y: api(2), floor: 1 },
  { ...finalTarget },
];

const current = {
  x: api(2),
  y: api(2),
  floor: 1,
  buildingId: 'office',
  heading: 0,
  state: 'routing',
  visualState: {
    runtimeRoute: {
      active: true,
      source: 'dynamic-interior-routing.js',
      reason: 'active-route',
      routeIndex: 1,
      route: wallCutRoutePoints.slice(1),
      routePoints: wallCutRoutePoints,
      finalPoint: finalTarget,
      effectiveTarget: finalTarget,
    },
  },
};

const step = makeServerRuntimeStep(dataDir, 'agent-collision', current, finalTarget, 100, {
  speedUnitsPerSec: 3000,
  arrivalRadius: 3,
  crowdAgents: [],
});

assert.ok(
  step.x / 40 < 3,
  `server must not publish a position past the interior wall at x=3: ${JSON.stringify({ x: step.x / 40, y: step.y / 40, route: step.route })}`,
);
assert.notEqual(step.arrived, true, 'agent must not arrive by cutting through an interior wall');
assert.match(
  step.route?.blockedReason || '',
  /^server-static-step-/,
  `blocked route should be marked so the next server tick replans: ${JSON.stringify(step.route)}`,
);

const validAroundWallRoutePoints = [
  { x: api(2), y: api(2), floor: 1 },
  { x: api(2), y: api(7), floor: 1 },
  { x: api(5), y: api(7), floor: 1 },
  { ...finalTarget },
];
const validAroundWallStep = makeServerRuntimeStep(dataDir, 'agent-valid-corner-route', {
  x: api(2),
  y: api(2),
  floor: 1,
  buildingId: 'office',
  heading: 0,
  state: 'routing',
  visualState: {
    runtimeRoute: {
      active: true,
      source: 'dynamic-interior-routing.js',
      reason: 'cached-server-route',
      routeIndex: 1,
      route: validAroundWallRoutePoints.slice(1),
      routePoints: validAroundWallRoutePoints,
      finalPoint: finalTarget,
      effectiveTarget: validAroundWallRoutePoints[1],
    },
  },
}, finalTarget, 100, {
  speedUnitsPerSec: 3000,
  arrivalRadius: 3,
  crowdAgents: [],
});

assert.equal(
  validAroundWallStep.x,
  finalTarget.x,
  `server should follow validated route subsegments around the wall instead of treating the whole tick as a wall cut: ${JSON.stringify(validAroundWallStep)}`,
);
assert.equal(
  validAroundWallStep.y,
  finalTarget.y,
  `server should consume the valid routed corner path without freezing before the final leg: ${JSON.stringify(validAroundWallStep)}`,
);
assert.doesNotMatch(
  validAroundWallStep.route?.blockedReason || '',
  /^server-static-step-/,
  `valid segmented route around a wall must not be invalidated by the aggregate tick chord: ${JSON.stringify(validAroundWallStep.route)}`,
);

const staleRouteIndexStep = makeServerRuntimeStep(dataDir, 'agent-stale-cached-route', {
  x: api(2),
  y: api(2),
  floor: 1,
  buildingId: 'office',
  heading: 0,
  state: 'routing',
  visualState: {
    runtimeRoute: {
      active: true,
      source: 'dynamic-interior-routing.js',
      reason: 'cached-server-route',
      routeIndex: validAroundWallRoutePoints.length - 1,
      route: validAroundWallRoutePoints.slice(1),
      routePoints: validAroundWallRoutePoints,
      finalPoint: finalTarget,
      effectiveTarget: finalTarget,
    },
  },
}, finalTarget, 100, {
  speedUnitsPerSec: 3000,
  arrivalRadius: 3,
  crowdAgents: [],
});

assert.equal(
  staleRouteIndexStep.x,
  finalTarget.x,
  `stale cached route indexes should re-project to the route corridor instead of cutting directly through the wall: ${JSON.stringify(staleRouteIndexStep)}`,
);
assert.equal(
  staleRouteIndexStep.y,
  finalTarget.y,
  `stale cached route indexes should still consume the valid detour route: ${JSON.stringify(staleRouteIndexStep)}`,
);
assert.doesNotMatch(
  staleRouteIndexStep.route?.blockedReason || '',
  /^server-static-step-/,
  `stale route-index repair should not publish or mark a direct wall cut: ${JSON.stringify(staleRouteIndexStep.route)}`,
);

configureDynamicExteriorRouting({
  apiToWorldScale: 1 / 40,
  terrain: {
    SIDEWALK: 1,
    ROAD: 2,
    GRASS: 3,
    DIRT: 4,
    SAND: 5,
    PARKING: 6,
  },
  getWorldTile: () => 1,
  findNearestSidewalk: (x, z) => ({ x, z }),
  pathfindSidewalk: (sx, sz, gx, gz) => [{ x: sx, z: sz }, { x: gx, z: gz }],
  isCrosswalk: () => false,
  getInteriorBuildingAt: () => null,
  getParkAt: () => null,
  probeObstacleAtWorld: () => null,
});
const exteriorFinalTarget = { x: api(50), y: api(50), floor: 1 };
const staleTrimmedExteriorStart = { x: api(20), y: api(20), floor: 1 };
const staleTrimmedExteriorStep = makeServerRuntimeStep(dataDir, 'agent-stale-trimmed-exterior-route', {
  ...staleTrimmedExteriorStart,
  heading: 0,
  state: 'routing',
  visualState: {
    runtimeRoute: {
      active: true,
      source: 'dynamic-exterior-routing.js',
      reason: 'cached-server-route',
      routeIndex: 1,
      route: [
        { x: api(19), y: api(19), floor: 1 },
      ],
      routePoints: [
        { x: api(18), y: api(18), floor: 1 },
        { x: api(19), y: api(19), floor: 1 },
      ],
      finalPoint: exteriorFinalTarget,
      effectiveTarget: { x: api(19), y: api(19), floor: 1 },
    },
  },
}, exteriorFinalTarget, 100, {
  speedUnitsPerSec: 72,
  arrivalRadius: 3,
  crowdAgents: [],
});
assert.notEqual(
  staleTrimmedExteriorStep.route?.reason,
  'cached-server-route',
  `trimmed exterior debug routes that do not reach the target must not be reused as movement cache: ${JSON.stringify(staleTrimmedExteriorStep.route)}`,
);
assert.ok(
  Math.hypot(exteriorFinalTarget.x - staleTrimmedExteriorStep.x, exteriorFinalTarget.y - staleTrimmedExteriorStep.y) <
    Math.hypot(exteriorFinalTarget.x - staleTrimmedExteriorStart.x, exteriorFinalTarget.y - staleTrimmedExteriorStart.y),
  `agent should move toward the real exterior target instead of chasing the stale trimmed endpoint: ${JSON.stringify(staleTrimmedExteriorStep)}`,
);

const recoveryReplan = makeServerRuntimeStep(dataDir, 'agent-collision', {
  x: step.x,
  y: step.y,
  floor: 1,
  buildingId: 'office',
  heading: 0,
  state: 'routing',
  visualState: {
    runtimeRoute: step.route,
  },
}, finalTarget, 100, {
  speedUnitsPerSec: 72,
  arrivalRadius: 3,
  crowdAgents: [],
});

assert.ok(
  recoveryReplan.route?.recoveryAvoidPoint,
  `server static block should feed a temporary avoid point into the next planner pass: ${JSON.stringify(recoveryReplan.route)}`,
);
assert.ok(
  recoveryReplan.route?.recoveryAvoidRadiusWorld > 0,
  `server static recovery should carry an avoid radius: ${JSON.stringify(recoveryReplan.route)}`,
);
assert.ok(
  (recoveryReplan.route?.routePoints || []).some(point => point.y / 40 > 6),
  `recovery replan should route around the blocked wall instead of immediately rebuilding the same wall-cut route: ${JSON.stringify(recoveryReplan.route)}`,
);

const stillBlockedRecovery = makeServerRuntimeStep(dataDir, 'agent-collision', {
  x: api(3),
  y: api(2),
  floor: 1,
  buildingId: 'office',
  heading: 0,
  state: 'routing',
  visualState: {
    runtimeRoute: {
      active: true,
      source: 'dynamic-interior-routing.js',
      reason: 'cached-server-route',
      routeIndex: 1,
      route: [
        { x: api(4), y: api(2), floor: 1 },
        { x: api(4), y: api(7), floor: 1 },
      ],
      routePoints: [
        { x: api(3), y: api(2), floor: 1 },
        { x: api(4), y: api(2), floor: 1 },
        { x: api(4), y: api(7), floor: 1 },
      ],
      finalPoint: { x: api(4), y: api(7), floor: 1, buildingId: 'office' },
      effectiveTarget: { x: api(4), y: api(2), floor: 1 },
    },
  },
}, { x: api(4), y: api(7), floor: 1, buildingId: 'office', targetKind: 'world-point' }, 100, {
  speedUnitsPerSec: 6,
  arrivalRadius: 3,
  crowdAgents: [],
});

assert.equal(
  stillBlockedRecovery.x,
  api(3),
  `server must not keep publishing movement while the proposed endpoint is still blocked: ${JSON.stringify(stillBlockedRecovery)}`,
);
assert.match(
  stillBlockedRecovery.route?.blockedReason || '',
  /^server-static-step-/,
  `still-blocked start overlap should force a replan instead of raw recovery: ${JSON.stringify(stillBlockedRecovery.route)}`,
);

const adjustedDockTarget = { x: api(5), y: api(2), floor: 1, buildingId: 'office', targetKind: 'work-desk', objectKey: 'office:furniture:1:desk' };
const adjustedDockPoint = { x: api(2.6), y: api(2), floor: 1 };
const adjustedArrival = makeServerRuntimeStep(dataDir, 'agent-collision', {
  x: adjustedDockPoint.x,
  y: adjustedDockPoint.y,
  floor: 1,
  buildingId: 'office',
  heading: 0,
  state: 'routing',
  visualState: {
    runtimeRoute: {
      active: true,
      source: 'dynamic-interior-routing.js',
      reason: 'cached-server-route',
      routeIndex: 1,
      route: [adjustedDockPoint],
      routePoints: [
        { x: api(2), y: api(2), floor: 1 },
        adjustedDockPoint,
      ],
      finalPoint: adjustedDockTarget,
      effectiveTarget: adjustedDockPoint,
      targetAdjusted: true,
      adjustedTarget: adjustedDockPoint,
    },
  },
}, adjustedDockTarget, 100, {
  speedUnitsPerSec: 3000,
  arrivalRadius: 3,
  crowdAgents: [],
});

assert.equal(adjustedArrival.arrived, true, 'object dock targets should arrive at their reachable adjusted route point');
assert.equal(adjustedArrival.x, adjustedDockPoint.x, 'blocked adjusted arrivals must not snap through a wall to the authored object dock target');
assert.equal(adjustedArrival.y, adjustedDockPoint.y, 'blocked adjusted arrivals must remain at the reachable adjusted route point');
assert.match(
  adjustedArrival.route?.blockedReason || '',
  /^server-static-arrival-snap-/,
  `blocked adjusted arrival snaps should be visible in route debug state: ${JSON.stringify(adjustedArrival.route)}`,
);

const seedOffice = {
  id: 'seed-office',
  type: 'office',
  worldX: 0,
  worldY: -13,
  widthTiles: 30,
  heightTiles: 22,
  interior: {
    walls: [],
    furniture: [
      { type: 'counter', x: 24.187948209976394, z: 0.7904121338362842, floor: 1 },
      { type: 'microwave', x: 25.048, z: 0.79, floor: 1 },
    ],
  },
};
const seedDataDir = mkdtempSync(join(tmpdir(), 'vw-runtime-collision-seed-'));
mkdirSync(join(seedDataDir, 'buildings'), { recursive: true });
writeFileSync(join(seedDataDir, 'buildings', 'seed-office.json'), JSON.stringify(seedOffice, null, 2));
configureDynamicInteriorRouting({
  apiToWorldScale: 1 / 40,
  getInteriorBuildingAt: (apiX, apiY) => {
    const x = Number(apiX) / 40;
    const z = Number(apiY) / 40;
    return x >= seedOffice.worldX && x <= seedOffice.worldX + seedOffice.widthTiles &&
      z >= seedOffice.worldY && z <= seedOffice.worldY + seedOffice.heightTiles
      ? seedOffice
      : null;
  },
});
const seedTarget = {
  x: 1001.92,
  y: -457.2,
  floor: 1,
  buildingId: seedOffice.id,
  targetKind: 'object-instance',
};
const blockedLegacySeed = {
  x: 884.5422879119433,
  y: -482.1494028981311,
  floor: 1,
  buildingId: seedOffice.id,
  heading: 0,
  state: 'idle',
  visualState: null,
};
const blockedLegacySeedStep = makeServerRuntimeStep(
  seedDataDir,
  'vw-endurance-8b661c7c-3',
  blockedLegacySeed,
  seedTarget,
  100,
  { speedUnitsPerSec: 72, arrivalRadius: 3, crowdAgents: [] },
);
assert.match(
  blockedLegacySeedStep.route?.blockedReason || '',
  /^server-static-step-start-blocked/,
  `seed regression fixture must reproduce the blocked interior start: ${JSON.stringify(blockedLegacySeedStep)}`,
);

const seedRoom = makeFakeRuntimeRoom(seedDataDir);
const safeSeed = seedRoom.serverRuntimeSeedPosition('vw-endurance-8b661c7c-3', seedTarget);
const safeSeedStep = makeServerRuntimeStep(
  seedDataDir,
  'vw-endurance-8b661c7c-3',
  { ...safeSeed, state: 'idle', visualState: null },
  seedTarget,
  100,
  { speedUnitsPerSec: 72, arrivalRadius: 3, crowdAgents: [] },
);
assert.doesNotMatch(
  safeSeedStep.route?.blockedReason || '',
  /^server-static-step-start-blocked/,
  `missing runtime residents must be seeded onto a statically valid point: ${JSON.stringify({ safeSeed, safeSeedStep })}`,
);
assert.ok(
  safeSeedStep.arrived || Math.hypot(safeSeedStep.x - safeSeed.x, safeSeedStep.y - safeSeed.y) > 0.01,
  `safe runtime seed must be able to make immediate route progress: ${JSON.stringify({ safeSeed, safeSeedStep })}`,
);

const staleNowMs = Date.now();
const staleStartedAt = new Date(staleNowMs - SERVER_RUNTIME_ROUTE_STALE_AFTER_MS - 5000).toISOString();
writeFileSync(join(seedDataDir, 'world-meta.json'), JSON.stringify({
  agentLife: {
    worldActions: {
      active: [{
        id: 'stale-live-action',
        agentId: 'stale-live-agent',
        status: 'routing',
        actionType: 'life.heatFood',
        capabilityTag: 'life.food',
        priority: 'normal',
        source: { kind: 'agent-live-mode', requestId: 'stale-live-action' },
        target: { kind: 'world-point', x: seedTarget.x, y: seedTarget.y, floor: seedTarget.floor },
        result: { status: 'routing', reason: 'server-runtime-route-started' },
        timing: {
          createdAt: staleStartedAt,
          updatedAt: staleStartedAt,
          startedAt: staleStartedAt,
        },
        lifecycle: {
          previousStatus: 'route_pending',
          allowedNext: ['arrived', 'cancelled', 'expired', 'failed'],
          transitionLog: [],
        },
      }],
      history: [],
    },
  },
}, null, 2));
const staleRoom = makeFakeRuntimeRoom(seedDataDir);
staleRoom.state.agents.set('stale-live-agent', {
  agentId: 'stale-live-agent',
  mode: 'live',
  owner: 'server-live-action-runtime',
  ...safeSeed,
  state: 'routing',
  routeId: 'route-stale-live-action',
  worldActionId: 'stale-live-action',
  leaseOwner: 'server-runtime',
  leaseExpiresAt: new Date(staleNowMs + 10000).toISOString(),
  visualState: null,
});
staleRoom.liveActionRouteWatchdog.set('stale-live-action', {
  routeId: 'route-stale-live-action',
  lastProgressAtMs: staleNowMs - SERVER_RUNTIME_ROUTE_STALE_AFTER_MS - 5000,
  progressX: safeSeedStep.x,
  progressY: safeSeedStep.y,
  bestDistance: safeSeedStep.distanceToFinal,
});
const staleTick = staleRoom.tickLiveActionRuntime(100, staleNowMs, new Date(staleNowMs).toISOString());
const staleWorldActions = JSON.parse(readFileSync(join(seedDataDir, 'world-meta.json'), 'utf8')).agentLife.worldActions;
assert.equal(
  staleWorldActions.active.length,
  0,
  `stale Live Agent routes must leave the active action store: ${JSON.stringify({ staleNowMs, staleStartedAt, staleAfterMs: SERVER_RUNTIME_ROUTE_STALE_AFTER_MS, staleTick, staleWorldActions, cached: staleRoom.liveActionRuntimeStore })}`,
);
assert.equal(staleWorldActions.history[0]?.status, 'failed', 'stale Live Agent routes must settle as failed history');
assert.equal(
  staleWorldActions.history[0]?.failureReason,
  'route_unreachable',
  'stale Live Agent routes must use a server-valid failure reason so reconciliation cannot resurrect them',
);
assert.equal(staleWorldActions.history[0]?.result?.reason, 'route-stale', 'stale route diagnostics should preserve the watchdog reason');

const queueOffice = {
  id: 'queue-office',
  type: 'office',
  worldX: 20,
  worldY: 0,
  widthTiles: 20,
  heightTiles: 20,
  interior: {
    walls: [],
    furniture: [{
      type: 'checkoutCounter',
      x: 15,
      z: 9,
      floor: 1,
      actionLocations: [{
        id: 'queue',
        roles: ['queue', 'wait'],
        actionId: 'planning.schedule',
        serviceQueue: true,
        actionTarget: { x: 15, z: 10.85, floor: 1 },
        queueLocations: [
          { id: 'queue:0', spotId: 'queue:0', actionTarget: { x: 15, z: 10.85, floor: 1 }, queueIndex: 0 },
          { id: 'queue:1', spotId: 'queue:1', actionTarget: { x: 15, z: 11.85, floor: 1 }, queueIndex: 1 },
        ],
      }],
    }],
  },
};
const queueDataDir = mkdtempSync(join(tmpdir(), 'vw-runtime-collision-queue-'));
mkdirSync(join(queueDataDir, 'buildings'), { recursive: true });
writeFileSync(join(queueDataDir, 'buildings', 'queue-office.json'), JSON.stringify(queueOffice, null, 2));

const qx = (localTile) => api(20 + localTile);
const qz = (localTile) => api(localTile);
configureDynamicInteriorRouting({
  apiToWorldScale: 1 / 40,
  getInteriorBuildingAt: (apiX, apiY) => {
    const x = Number(apiX) / 40;
    const z = Number(apiY) / 40;
    return x >= 20 && x <= 40 && z >= 0 && z <= 20 ? queueOffice : null;
  },
});
const queueFinalTarget = serverScriptedServiceQueueSlotTarget(queueDataDir, {
  buildingId: 'queue-office',
  furnitureIndex: 0,
  objectType: 'checkoutCounter',
  spotId: 'queue',
  objectKey: 'queue-office:furniture:0:checkoutCounter',
  baseObjectKey: 'queue-office:furniture:0:checkoutCounter',
}, {
  agentId: 'agent-queue-corner',
  queueSpotId: 'queue',
  queueIndex: 1,
  actionId: 'planning.schedule',
});

const serviceBaseKey = 'queue-office:furniture:0:checkoutCounter';
const serviceUseTarget = {
  buildingId: 'queue-office',
  furnitureIndex: 0,
  objectType: 'checkoutCounter',
  objectKey: serviceBaseKey,
  baseObjectKey: serviceBaseKey,
  spotId: 'customer',
  isQueueUse: false,
};
const serviceQueueTarget = {
  buildingId: 'queue-office',
  furnitureIndex: 0,
  objectType: 'checkoutCounter',
  objectKey: `${serviceBaseKey}:queue:queue`,
  baseObjectKey: serviceBaseKey,
  spotId: 'queue',
  queueSpotId: 'queue',
  isQueueUse: true,
};
const stateWithOneQueued = {
  objects: new Map([[
    serviceBaseKey,
    {
      objectKey: serviceBaseKey,
      owner: 'server-scripted-object-runtime',
      objectType: 'checkoutCounter',
      buildingId: 'queue-office',
      furnitureIndex: 0,
      state: 'routing',
      agentId: 'service-agent',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      dataJson: JSON.stringify({
        _scriptedServiceQueueStore: {
          reservations: [{ agentId: 'queue-a', queueSpotId: 'queue', queueIndex: 0, state: 'queued', status: 'queued' }],
        },
      }),
    },
  ]]),
};
assert.equal(
  isServerScriptedObjectTargetAvailable(stateWithOneQueued, serviceUseTarget, 'new-agent', Date.now(), queueDataDir),
  false,
  'pending service queue must make the direct use-front target unavailable',
);
assert.equal(
  isServerScriptedObjectTargetAvailable(stateWithOneQueued, serviceQueueTarget, 'new-agent', Date.now(), queueDataDir),
  true,
  'busy service object with queue capacity should admit the next queue target',
);
const stateWithFullQueue = {
  objects: new Map([[
    serviceBaseKey,
    {
      ...stateWithOneQueued.objects.get(serviceBaseKey),
      dataJson: JSON.stringify({
        _scriptedServiceQueueStore: {
          reservations: [
            { agentId: 'queue-a', queueSpotId: 'queue', queueIndex: 0, state: 'queued', status: 'queued' },
            { agentId: 'queue-b', queueSpotId: 'queue', queueIndex: 1, state: 'queued', status: 'queued' },
          ],
        },
      }),
    },
  ]]),
};
assert.equal(
  isServerScriptedObjectTargetAvailable(stateWithFullQueue, serviceQueueTarget, 'new-agent', Date.now(), queueDataDir),
  false,
  'full service queue must make the queue target unavailable for new agents',
);
assert.equal(
  isServerScriptedObjectTargetAvailable(stateWithFullQueue, serviceQueueTarget, 'queue-a', Date.now(), queueDataDir),
  true,
  'an existing queued agent may keep its queue target even when the queue is full',
);

const nowForSeatClaim = Date.now();
const seatObjectKey = 'seat-office:furniture:4:armchair';
const seatTarget = {
  x: api(2),
  y: api(2),
  floor: 1,
  buildingId: 'seat-office',
  furnitureIndex: 4,
  objectType: 'armchair',
  objectKey: seatObjectKey,
  baseObjectKey: seatObjectKey,
  spotId: 'seat',
  slotId: 'seat',
  poseKind: 'seat',
  isQueueUse: false,
};
const stateWithRuntimeSeatClaim = {
  objects: new Map(),
  agents: new Map([[
    'seated-agent',
    {
      agentId: 'seated-agent',
      owner: 'server-scripted-object-runtime',
      x: seatTarget.x,
      y: seatTarget.y,
      floor: 1,
      buildingId: 'seat-office',
      heading: 0,
      state: 'using',
      targetJson: JSON.stringify(seatTarget),
      leaseOwner: 'server-scripted-object',
      leaseExpiresAt: new Date(nowForSeatClaim + 60000).toISOString(),
    },
  ]]),
};
assert.equal(
  isServerScriptedObjectTargetAvailable(stateWithRuntimeSeatClaim, seatTarget, 'new-seat-agent', nowForSeatClaim, queueDataDir),
  false,
  'seat-like furniture must stay unavailable while another runtime agent is seated there even if the object reservation is missing',
);
assert.equal(
  isServerScriptedObjectTargetAvailable(stateWithRuntimeSeatClaim, seatTarget, 'seated-agent', nowForSeatClaim, queueDataDir),
  true,
  'the seated owner may keep its own seat target',
);

const armchairOffice = {
  id: 'armchair-office',
  type: 'office',
  worldX: 70,
  worldY: 0,
  widthTiles: 10,
  heightTiles: 10,
  interior: {
    walls: [],
    furniture: [{
      type: 'armchair',
      x: 4,
      z: 4,
      floor: 1,
      actionLocations: [
        {
          id: 'approach-front',
          spotId: 'approach-front',
          roles: ['approach', 'queue', 'staging'],
          capacityKind: 'queue',
          capacity: 1,
          actionTarget: { x: 4, z: 5.18, floor: 1, facing: 'north' },
          buildingLocal: { x: 4, z: 5.18, floor: 1, facing: 'north' },
        },
        {
          id: 'stand-front',
          spotId: 'stand-front',
          roles: ['dismount', 'exit', 'stand'],
          capacityKind: 'queue',
          capacity: 1,
          actionTarget: { x: 4, z: 5.18, floor: 1, facing: 'north' },
          buildingLocal: { x: 4, z: 5.18, floor: 1, facing: 'north' },
        },
        {
          id: 'seat',
          spotId: 'seat',
          roles: ['seat', 'use', 'social'],
          slotId: 'seat',
          approachSpotId: 'approach-front',
          dockMode: 'snap-to-activation',
          snapRadius: 7,
          activationRadius: 8,
          actionTarget: { spotId: 'approach-front', x: 4, z: 5.18, floor: 1, facing: 'north' },
          activationTarget: { spotId: 'seat', x: 4, z: 4.42, floor: 1, facing: 'north' },
        },
      ],
    }],
  },
};
const armchairDataDir = mkdtempSync(join(tmpdir(), 'vw-runtime-collision-armchair-'));
mkdirSync(join(armchairDataDir, 'buildings'), { recursive: true });
writeFileSync(join(armchairDataDir, 'buildings', 'armchair-office.json'), JSON.stringify(armchairOffice, null, 2));
const armchairTargets = listScriptedObjectRuntimeTargets(armchairDataDir)
  .filter(target => target.objectType === 'armchair');
assert.equal(armchairTargets.length, 1, `armchair should expose one runtime target: ${JSON.stringify(armchairTargets)}`);
const armchairTarget = armchairTargets[0];
const armchairApiX = (localX) => api(70 + localX);
const armchairApiZ = (localZ) => api(localZ);
const armchairSeatX = armchairApiX(4);
const armchairSeatY = armchairApiZ(4.42);
const armchairApproachX = armchairApiX(4);
const armchairApproachY = armchairApiZ(5.18);
const armchairDismountX = armchairApiX(5.05);
const armchairDismountY = armchairSeatY;
assert.equal(armchairTarget.spotId, 'seat', `armchair target should keep the seat spot: ${JSON.stringify(armchairTarget)}`);
assert.equal(armchairTarget.poseKind, 'seat', `armchair target should be seated: ${JSON.stringify(armchairTarget)}`);
assert.equal(armchairTarget.x, armchairSeatX, 'armchair seat target should resolve to activationTarget.x, not stand-front');
assert.equal(armchairTarget.y, armchairSeatY, 'armchair seat target should resolve to activationTarget.z, not stand-front');
assert.equal(armchairTarget.routeApproachTarget?.x, armchairApproachX, 'armchair approach route should keep actionTarget.x');
assert.equal(armchairTarget.routeApproachTarget?.y, armchairApproachY, 'armchair approach route should keep actionTarget.z');
assert.ok(
  Math.abs(Number(armchairTarget.faceAngle || 0)) < 0.0001,
  `armchair seat target should face the authored forward direction instead of facing back toward the chair center: ${JSON.stringify(armchairTarget)}`,
);
configureDynamicInteriorRouting({
  apiToWorldScale: 1 / 40,
  getInteriorBuildingAt: (apiX, apiY) => {
    const x = Number(apiX) / 40;
    const z = Number(apiY) / 40;
    return x >= 70 && x <= 80 && z >= 0 && z <= 10 ? armchairOffice : null;
  },
});
const armchairApproachStep = makeServerRuntimeStep(armchairDataDir, 'agent-armchair-approach', {
  x: armchairApiX(4),
  y: armchairApiZ(7),
  floor: 1,
  buildingId: 'armchair-office',
  heading: 0,
  state: 'routing',
  visualState: null,
}, armchairTarget, 100, {
  speedUnitsPerSec: 72,
  arrivalRadius: 3,
  crowdAgents: [],
});
assert.equal(armchairApproachStep.arrived, false, 'agent should route to the front approach point before docking to the armchair seat');
assert.equal(
  armchairApproachStep.route?.finalPoint?.y,
  armchairApproachY,
  `armchair route should aim at the approach point while outside the snap radius: ${JSON.stringify(armchairApproachStep.route)}`,
);
const armchairDockStep = makeServerRuntimeStep(armchairDataDir, 'agent-armchair-dock', {
  x: armchairApproachX,
  y: armchairApproachY,
  floor: 1,
  buildingId: 'armchair-office',
  heading: 0,
  state: 'routing',
  visualState: null,
}, armchairTarget, 100, {
  speedUnitsPerSec: 72,
  arrivalRadius: 3,
  crowdAgents: [],
});
assert.equal(armchairDockStep.arrived, true, `agent at the approach point should dock onto the armchair seat: ${JSON.stringify(armchairDockStep)}`);
assert.equal(armchairDockStep.x, armchairSeatX, 'armchair dock should publish the seat x coordinate');
assert.equal(armchairDockStep.y, armchairSeatY, 'armchair dock should publish the seat y coordinate');
assert.equal(
  armchairDockStep.route?.dockSnapReason,
  'seat-route-approach-complete',
  `armchair dock should explain the approach-to-seat snap: ${JSON.stringify(armchairDockStep.route)}`,
);
const armchairReleaseRoom = makeFakeRuntimeRoom(armchairDataDir);
const armchairRelease = armchairReleaseRoom.releaseServerScriptedObjectRoute('agent-armchair-release', {
  agentId: 'agent-armchair-release',
  x: armchairSeatX,
  y: armchairSeatY,
  floor: 1,
  buildingId: 'armchair-office',
  heading: 0,
  state: 'using',
}, armchairTarget, Date.now(), new Date().toISOString(), 'verify-dismount');
assert.notEqual(armchairRelease.agent.x, armchairApproachX, 'completed armchair use must not dismount onto the approach/front x point');
assert.notEqual(armchairRelease.agent.y, armchairApproachY, 'completed armchair use must not dismount onto the approach/front y point');
assert.ok(
  Math.abs(armchairRelease.agent.x - armchairDismountX) < 0.001,
  `completed armchair use should synthesize a side dismount x point: ${JSON.stringify(armchairRelease.agent)}`,
);
assert.ok(
  Math.abs(armchairRelease.agent.y - armchairDismountY) < 0.001,
  `completed armchair use should synthesize a side dismount y point: ${JSON.stringify(armchairRelease.agent)}`,
);
assert.equal(armchairRelease.agent.state, 'routing', 'completed armchair use should immediately route away from the shared dismount point');
const armchairClearanceTarget = JSON.parse(armchairRelease.agent.targetJson || '{}');
assert.equal(armchairClearanceTarget.targetKind, 'server-runtime-dismount-clearance', 'completed armchair use should get a transient dismount-clearance target');
assert.ok(
  Math.hypot(armchairClearanceTarget.x - armchairRelease.agent.x, armchairClearanceTarget.y - armchairRelease.agent.y) > api(0.7),
  `dismount-clearance target should move the agent away from the dismount point: ${JSON.stringify({ release: armchairRelease.agent, target: armchairClearanceTarget })}`,
);
const armchairClearanceStep = makeServerRuntimeStep(armchairDataDir, 'agent-armchair-release', {
  agentId: 'agent-armchair-release',
  x: armchairRelease.agent.x,
  y: armchairRelease.agent.y,
  floor: armchairRelease.agent.floor,
  buildingId: 'armchair-office',
  heading: armchairRelease.agent.heading,
  state: 'routing',
  visualState: JSON.parse(armchairRelease.agent.visualStateJson || '{}'),
}, armchairClearanceTarget, 250, {
  speedUnitsPerSec: 72,
  arrivalRadius: 3,
  crowdAgents: [],
});
assert.ok(
  Math.hypot(armchairClearanceStep.x - armchairRelease.agent.x, armchairClearanceStep.y - armchairRelease.agent.y) > 1,
  `dismount-clearance route should publish movement away from the shared dismount point: ${JSON.stringify(armchairClearanceStep)}`,
);
const secondArmchairRelease = armchairReleaseRoom.releaseServerScriptedObjectRoute('agent-armchair-release-2', {
  agentId: 'agent-armchair-release-2',
  x: armchairSeatX,
  y: armchairSeatY,
  floor: 1,
  buildingId: 'armchair-office',
  heading: 0,
  state: 'using',
}, armchairTarget, Date.now(), new Date().toISOString(), 'verify-second-dismount');
assert.ok(
  Math.hypot(secondArmchairRelease.agent.x - armchairRelease.agent.x, secondArmchairRelease.agent.y - armchairRelease.agent.y) >= SERVER_RUNTIME_AGENT_HARD_SEPARATION_RADIUS,
  `second armchair release should avoid an occupied dismount point: ${JSON.stringify({ first: armchairRelease.agent, second: secondArmchairRelease.agent })}`,
);
const armchairSeatRoom = makeFakeRuntimeRoom(armchairDataDir);
armchairSeatRoom.upsertWorldObject({
  objectKey: armchairTarget.objectKey,
  owner: 'server-scripted-object-runtime',
  objectType: 'armchair',
  buildingId: 'armchair-office',
  furnitureIndex: 0,
  state: 'active',
  agentId: 'agent-already-seated',
  actionId: 'life.restAtArmchair',
  reservationId: 'server-res:armchair:occupied',
  activeUseId: 'server-active:armchair:occupied',
  slotId: 'seat',
  expiresAt: new Date(Date.now() + 60000).toISOString(),
}, 'seed-occupied-armchair');
assert.throws(
  () => armchairSeatRoom.startServerScriptedObjectRoute('agent-second-seat', armchairTarget, Date.now(), new Date().toISOString(), { source: 'verify', force: true }),
  error => error?.code === 'object_state_conflict',
  'forced server scripted routes must not stack another agent onto an active occupied armchair seat',
);

const deskOffice = {
  id: 'desk-office',
  type: 'office',
  worldX: 45,
  worldY: 25,
  widthTiles: 12,
  heightTiles: 10,
  interior: {
    walls: [],
    furniture: [
      { type: 'desk', x: 2, z: 2, floor: 1 },
      { type: 'desk', x: 5, z: 2, floor: 1 },
    ],
  },
};
const deskDataDir = mkdtempSync(join(tmpdir(), 'vw-runtime-collision-desk-'));
mkdirSync(join(deskDataDir, 'buildings'), { recursive: true });
writeFileSync(join(deskDataDir, 'buildings', 'desk-office.json'), JSON.stringify(deskOffice, null, 2));
const deskConsumeSourceTarget = {
  buildingId: 'desk-office',
  objectType: 'watercooler',
  objectKey: 'desk-office:furniture:9:watercooler',
  baseObjectKey: 'desk-office:furniture:9:watercooler',
  activityKind: 'water-cooler-get-water',
  actionId: 'life.getWater',
};
const deskRuntimeState = {
  agents: new Map([[
    'agent-desk-a',
    {
      agentId: 'agent-desk-a',
      mode: 'scripted',
      owner: 'server-scripted-object-runtime',
      x: api(47),
      y: api(27.8),
      floor: 1,
      buildingId: 'desk-office',
      state: 'routing',
      targetJson: JSON.stringify({
        buildingId: 'desk-office',
        furnitureIndex: 0,
        objectType: 'desk',
        targetKind: 'work-desk',
        objectKey: 'desk-office:furniture:0:desk:consume:agent-desk-a',
        baseObjectKey: 'desk-office:furniture:0:desk',
        activityKind: 'water-desk-consume',
        runtimePhase: 'desk-routing',
      }),
    },
  ]]),
};
const secondDeskConsumeTarget = makeServerScriptedDeskConsumeTarget(deskDataDir, 'agent-desk-b', deskConsumeSourceTarget, Date.now(), deskRuntimeState);
assert.equal(
  secondDeskConsumeTarget?.furnitureIndex,
  1,
  `desk consume routing should avoid a desk already claimed by another agent: ${JSON.stringify(secondDeskConsumeTarget)}`,
);
const deskReleaseRoom = makeFakeRuntimeRoom(deskDataDir);
const deskRelease = deskReleaseRoom.releaseServerScriptedObjectRoute('agent-desk-b', {
  agentId: 'agent-desk-b',
  x: secondDeskConsumeTarget.x,
  y: secondDeskConsumeTarget.y,
  floor: 1,
  buildingId: 'desk-office',
  heading: secondDeskConsumeTarget.faceAngle || 0,
  state: 'using',
}, secondDeskConsumeTarget, Date.now(), new Date().toISOString(), 'verify-desk-dismount');
assert.ok(
  Math.hypot(Number(deskRelease.agent.x) - Number(secondDeskConsumeTarget.x), Number(deskRelease.agent.y) - Number(secondDeskConsumeTarget.y)) > 1,
  `completed desk-chair-style use should not leave the agent standing at the work/seat coordinate: ${JSON.stringify({ release: deskRelease.agent, target: secondDeskConsumeTarget })}`,
);
deskRuntimeState.agents.set('agent-desk-b', {
  agentId: 'agent-desk-b',
  mode: 'scripted',
  owner: 'server-scripted-object-runtime',
  x: api(50),
  y: api(27.8),
  floor: 1,
  buildingId: 'desk-office',
  state: 'routing',
  targetJson: JSON.stringify({
    buildingId: 'desk-office',
    furnitureIndex: 1,
    objectType: 'desk',
    targetKind: 'work-desk',
    objectKey: 'desk-office:furniture:1:desk:consume:agent-desk-b',
    baseObjectKey: 'desk-office:furniture:1:desk',
    activityKind: 'water-desk-consume',
    runtimePhase: 'desk-routing',
  }),
});
assert.equal(
  makeServerScriptedDeskConsumeTarget(deskDataDir, 'agent-desk-c', deskConsumeSourceTarget, Date.now(), deskRuntimeState),
  null,
  'desk consume routing should not stack on occupied desks when every desk point is claimed',
);
configureDynamicInteriorRouting({
  apiToWorldScale: 1 / 40,
  getInteriorBuildingAt: (apiX, apiY) => {
    const x = Number(apiX) / 40;
    const z = Number(apiY) / 40;
    return x >= 20 && x <= 40 && z >= 0 && z <= 20 ? queueOffice : null;
  },
});
const queueCornerSlide = makeServerRuntimeStep(queueDataDir, 'agent-queue-corner', {
  x: qx(13.4),
  y: qz(8.2),
  floor: 1,
  buildingId: 'queue-office',
  heading: 0,
  state: 'idle',
}, queueFinalTarget, 100, {
  speedUnitsPerSec: 200,
  arrivalRadius: 5,
  crowdAgents: [],
});

assert.ok(
  queueCornerSlide.y > qz(8.2),
  `pathfinder route should slide forward from a collider corner instead of freezing: ${JSON.stringify(queueCornerSlide)}`,
);
assert.ok(
  queueCornerSlide.x < qx(13.35),
  `pathfinder slide should move away from the checkout counter corner before advancing: ${JSON.stringify(queueCornerSlide)}`,
);
assert.match(
  queueCornerSlide.route?.blockedReason || '',
  /^server-static-slide-/,
  `pathfinder corner slide should be visible in route debug state: ${JSON.stringify(queueCornerSlide.route)}`,
);

const wallHandoffBuilding = {
  id: 'handoff-office',
  type: 'office',
  worldX: 50,
  worldY: 0,
  widthTiles: 10,
  heightTiles: 10,
  interior: { walls: [], furniture: [] },
};
const handoffDataDir = mkdtempSync(join(tmpdir(), 'vw-runtime-collision-handoff-'));
mkdirSync(join(handoffDataDir, 'buildings'), { recursive: true });
writeFileSync(join(handoffDataDir, 'buildings', 'handoff-office.json'), JSON.stringify(wallHandoffBuilding, null, 2));
const hx = (localTile) => api(50 + localTile);
const hz = (localTile) => api(localTile);
const wallHandoffTarget = { x: hx(1.2), y: hz(5), floor: 1, buildingId: 'handoff-office', targetKind: 'work-desk', objectKey: 'handoff-office:furniture:0:desk' };
const wallHandoff = makeServerRuntimeStep(handoffDataDir, 'agent-wall-handoff', {
  x: hx(-0.2),
  y: hz(5),
  floor: 1,
  buildingId: '',
  heading: 0,
  state: 'routing',
  visualState: {
    runtimeRoute: {
      active: true,
      source: 'dynamic-exterior-routing.js',
      reason: 'cached-server-route',
      routeIndex: 1,
      route: [wallHandoffTarget],
      routePoints: [
        { x: hx(-0.2), y: hz(5), floor: 1 },
        wallHandoffTarget,
      ],
      finalPoint: wallHandoffTarget,
      effectiveTarget: wallHandoffTarget,
    },
  },
}, wallHandoffTarget, 100, {
  speedUnitsPerSec: 2000,
  arrivalRadius: 5,
  crowdAgents: [],
});
assert.ok(
  wallHandoff.x < hx(0),
  `server must not enter a building through a non-door side wall: ${JSON.stringify(wallHandoff)}`,
);
assert.match(
  wallHandoff.route?.blockedReason || '',
  /^server-static-step-building-wall-handoff/,
  `side-wall handoff should be marked as a static building-wall block: ${JSON.stringify(wallHandoff.route)}`,
);

const doorHandoffTarget = { x: hx(5), y: hz(8.8), floor: 1, buildingId: 'handoff-office', targetKind: 'work-desk', objectKey: 'handoff-office:furniture:1:desk' };
const doorHandoff = makeServerRuntimeStep(handoffDataDir, 'agent-door-handoff', {
  x: hx(5),
  y: hz(10.2),
  floor: 1,
  buildingId: '',
  heading: 0,
  state: 'idle',
}, doorHandoffTarget, 100, {
  speedUnitsPerSec: 200,
  arrivalRadius: 5,
  crowdAgents: [],
});
assert.ok(
  doorHandoff.y < hz(10),
  `server should still allow a doorway-corridor entry handoff: ${JSON.stringify(doorHandoff)}`,
);
assert.doesNotMatch(
  doorHandoff.route?.blockedReason || '',
  /building-wall-handoff/,
  `doorway handoff must not be treated like a side-wall cut: ${JSON.stringify(doorHandoff.route)}`,
);

const crowdOffice = {
  id: 'crowd-office',
  type: 'office',
  worldX: 70,
  worldY: 0,
  widthTiles: 10,
  heightTiles: 10,
  interior: { walls: [], furniture: [] },
};
const crowdDataDir = mkdtempSync(join(tmpdir(), 'vw-runtime-collision-crowd-'));
mkdirSync(join(crowdDataDir, 'buildings'), { recursive: true });
writeFileSync(join(crowdDataDir, 'buildings', 'crowd-office.json'), JSON.stringify(crowdOffice, null, 2));
const cx = (localTile) => api(70 + localTile);
const cy = (localTile) => api(localTile);
configureDynamicInteriorRouting({
  apiToWorldScale: 1 / 40,
  getInteriorBuildingAt: (apiX, apiY) => {
    const x = Number(apiX) / 40;
    const z = Number(apiY) / 40;
    return x >= 70 && x <= 80 && z >= 0 && z <= 10 ? crowdOffice : null;
  },
});
const crowdTarget = { x: cx(4), y: cy(2), floor: 1, buildingId: 'crowd-office' };
const dynamicAvoidRoute = makeServerRuntimeStep(crowdDataDir, 'agent-crowd-dynamic-route', {
  x: cx(2),
  y: cy(2),
  floor: 1,
  buildingId: 'crowd-office',
  heading: 0,
  state: 'routing',
}, crowdTarget, 100, {
  speedUnitsPerSec: 80,
  arrivalRadius: 3,
  crowdAgents: [
    { agentId: 'agent-crowd-route-blocker', x: cx(3), y: cy(2), floor: 1, buildingId: 'crowd-office', state: 'idle' },
  ],
});
assert.ok(
  dynamicAvoidRoute.route?.dynamicAvoidZoneCount > 0,
  `dynamic interior routes should carry lightweight nearby-agent avoid zones: ${JSON.stringify(dynamicAvoidRoute.route)}`,
);
assert.ok(
  (dynamicAvoidRoute.route?.routePoints || []).some(point => Math.abs(Number(point.y) - cy(2)) > api(0.35)),
  `dynamic interior routing should bend the path itself around a nearby agent blocker instead of relying only on collision slide: ${JSON.stringify(dynamicAvoidRoute.route)}`,
);

const crowdAvoided = makeServerRuntimeStep(crowdDataDir, 'agent-crowd-a', {
  x: cx(2),
  y: cy(2),
  floor: 1,
  buildingId: 'crowd-office',
  heading: 0,
  state: 'routing',
  visualState: {
    runtimeRoute: {
      active: true,
      source: 'dynamic-interior-routing.js',
      reason: 'cached-server-route',
      routeIndex: 1,
      route: [crowdTarget],
      routePoints: [
        { x: cx(2), y: cy(2), floor: 1 },
        crowdTarget,
      ],
      finalPoint: crowdTarget,
      effectiveTarget: crowdTarget,
    },
  },
}, crowdTarget, 100, {
  speedUnitsPerSec: 800,
  arrivalRadius: 3,
  crowdAgents: [
    { agentId: 'agent-crowd-b', x: cx(3), y: cy(2), floor: 1, buildingId: 'crowd-office', state: 'routing' },
  ],
});
const crowdDist = Math.hypot(crowdAvoided.x - cx(3), crowdAvoided.y - cy(2));
assert.ok(
  crowdDist >= SERVER_RUNTIME_AGENT_HARD_SEPARATION_RADIUS,
  `server must not publish movement through another agent capsule: ${JSON.stringify({ crowdDist, hard: SERVER_RUNTIME_AGENT_HARD_SEPARATION_RADIUS, crowdAvoided })}`,
);
assert.match(
  crowdAvoided.route?.blockedReason || '',
  /^server-crowd-/,
  `agent-agent avoidance should be visible in route debug state: ${JSON.stringify(crowdAvoided.route)}`,
);
assert.ok(
  crowdAvoided.route?.blockedPoint,
  `crowd slide/wait routes should include a blocked point so the next tick replans around the actual blocker: ${JSON.stringify(crowdAvoided.route)}`,
);
const crowdSlideRecovery = makeServerRuntimeStep(crowdDataDir, 'agent-crowd-a', {
  x: crowdAvoided.x,
  y: crowdAvoided.y,
  floor: 1,
  buildingId: 'crowd-office',
  heading: crowdAvoided.heading,
  state: 'routing',
  visualState: { runtimeRoute: crowdAvoided.route },
}, crowdTarget, 100, {
  speedUnitsPerSec: 80,
  arrivalRadius: 3,
  crowdAgents: [
    { agentId: 'agent-crowd-b', x: cx(3), y: cy(2), floor: 1, buildingId: 'crowd-office', state: 'routing' },
  ],
});
assert.ok(
  crowdSlideRecovery.route?.recoveryAvoidPoint,
  `crowd slide routes should force the next tick into route recovery instead of reusing the stale corridor: ${JSON.stringify(crowdSlideRecovery.route)}`,
);

const crowdWait = makeServerRuntimeStep(crowdDataDir, 'agent-crowd-wait', {
  x: cx(2),
  y: cy(5),
  floor: 1,
  buildingId: 'crowd-office',
  heading: 0,
  state: 'routing',
  visualState: {
    runtimeRoute: {
      active: true,
      source: 'dynamic-interior-routing.js',
      reason: 'cached-server-route',
      routeIndex: 1,
      route: [{ x: cx(4), y: cy(5), floor: 1 }],
      routePoints: [
        { x: cx(2), y: cy(5), floor: 1 },
        { x: cx(4), y: cy(5), floor: 1 },
      ],
      finalPoint: { x: cx(4), y: cy(5), floor: 1 },
      effectiveTarget: { x: cx(4), y: cy(5), floor: 1 },
    },
  },
}, { x: cx(4), y: cy(5), floor: 1, buildingId: 'crowd-office' }, 100, {
  speedUnitsPerSec: 800,
  arrivalRadius: 3,
  crowdAgents: [
    { agentId: 'agent-crowd-block-center', x: cx(3), y: cy(5), floor: 1, buildingId: 'crowd-office', state: 'idle' },
    { agentId: 'agent-crowd-block-up', x: cx(2.8), y: cy(5.72), floor: 1, buildingId: 'crowd-office', state: 'idle' },
    { agentId: 'agent-crowd-block-down', x: cx(2.8), y: cy(4.28), floor: 1, buildingId: 'crowd-office', state: 'idle' },
  ],
});
assert.match(
  crowdWait.route?.blockedReason || '',
  /^server-crowd-wait-/,
  `unslidable crowd block should wait and mark the route for recovery: ${JSON.stringify(crowdWait.route)}`,
);
assert.ok(
  crowdWait.route?.blockedPoint,
  `crowd wait routes should carry a blocked point for recovery replans: ${JSON.stringify(crowdWait.route)}`,
);
const crowdRecovery = makeServerRuntimeStep(crowdDataDir, 'agent-crowd-wait', {
  x: crowdWait.x,
  y: crowdWait.y,
  floor: 1,
  buildingId: 'crowd-office',
  heading: 0,
  state: 'routing',
  visualState: { runtimeRoute: crowdWait.route },
}, { x: cx(4), y: cy(5), floor: 1, buildingId: 'crowd-office' }, 100, {
  speedUnitsPerSec: 72,
  arrivalRadius: 3,
  crowdAgents: [
    { agentId: 'agent-crowd-block-center', x: cx(3), y: cy(5), floor: 1, buildingId: 'crowd-office', state: 'idle' },
  ],
});
assert.ok(
  crowdRecovery.route?.recoveryAvoidPoint,
  `crowd wait should feed the blocked point into the next replan instead of reusing the same route: ${JSON.stringify(crowdRecovery.route)}`,
);

const fakeRoom = Object.create(AgentRuntimeRoom.prototype);
fakeRoom.dataDir = crowdDataDir;
fakeRoom.state = { agents: new Map(), objects: new Map(), updatedAt: '' };
fakeRoom.events = [];
fakeRoom.worldRuntimeTickContext = null;
fakeRoom.serverRuntimeBlockerYieldCooldowns = new Map();
fakeRoom.recordEvent = () => ({});
fakeRoom.persistRuntimeDocument = () => {};
fakeRoom.broadcastRuntimeState = () => {};
fakeRoom.upsertSnapshot({
  agentId: 'agent-crowd-mover',
  mode: 'live',
  owner: 'server-scripted-object-runtime',
  x: cx(2),
  y: cy(7),
  floor: 1,
  buildingId: 'crowd-office',
  state: 'routing',
  target: { x: cx(4), y: cy(7), floor: 1, buildingId: 'crowd-office' },
  leaseOwner: 'server-scripted-object',
  leaseExpiresAt: new Date(Date.now() + 10000).toISOString(),
}, 'seed-mover');
fakeRoom.upsertSnapshot({
  agentId: 'agent-idle-blocker',
  mode: 'scripted',
  owner: 'agent-scripted-mode',
  x: cx(3),
  y: cy(7),
  floor: 1,
  buildingId: 'crowd-office',
  state: 'idle',
  target: null,
  leaseOwner: '',
  leaseExpiresAt: '',
}, 'seed-blocker');
const beforeBlocker = fakeRoom.state.agents.get('agent-idle-blocker');
const nudged = fakeRoom.tryNudgeServerRuntimeCrowdBlocker('agent-crowd-mover', {
  x: cx(2),
  y: cy(7),
  floor: 1,
  buildingId: 'crowd-office',
}, {
  x: cx(4),
  y: cy(7),
  floor: 1,
  buildingId: 'crowd-office',
}, {
  blockedReason: 'server-crowd-wait-path-block',
  crowdAvoidedAgents: [{ agentId: 'agent-idle-blocker', distance: 0, mode: 'path-block' }],
}, Date.now(), new Date().toISOString());
const afterBlocker = fakeRoom.state.agents.get('agent-idle-blocker');
assert.equal(nudged.nudged, true, `idle blocker should be nudged out of the moving agent path: ${JSON.stringify(nudged)}`);
assert.ok(
  Math.hypot(Number(afterBlocker.x) - Number(beforeBlocker.x), Number(afterBlocker.y) - Number(beforeBlocker.y)) > 1,
  'idle blocker nudge should update the blocker position',
);

const largeRoutePoints = Array.from({ length: 220 }, (_, index) => ({
  x: cx(1 + index * 0.05),
  y: cy(1 + index * 0.03),
  floor: 1,
}));
assert.doesNotThrow(() => fakeRoom.upsertSnapshot({
  agentId: 'agent-large-route-debug',
  mode: 'live',
  owner: 'server-scripted-object-runtime',
  x: cx(1),
  y: cy(1),
  floor: 1,
  buildingId: 'crowd-office',
  state: 'routing',
  target: { x: cx(9), y: cy(9), floor: 1, buildingId: 'crowd-office' },
  leaseOwner: 'server-scripted-object',
  leaseExpiresAt: new Date(Date.now() + 10000).toISOString(),
  visualState: {
    schemaVersion: 'agent-runtime-visual/v1',
    status: 'idle',
    state: 'moving',
    resolvedAnimationId: 'walk',
    movement: { isMoving: true, isRunning: false },
    activityActive: true,
    activity: { kind: 'large-route-debug', phase: 'routing' },
    carrying: false,
    runtimeRoute: {
      schemaVersion: 'agent-runtime-server-route/v1',
      source: 'dynamic-interior-routing.js',
      active: true,
      reason: 'large-route-debug',
      routeIndex: 1,
      routeLength: largeRoutePoints.length,
      nextPoint: largeRoutePoints[1],
      finalPoint: largeRoutePoints[largeRoutePoints.length - 1],
      routePoints: largeRoutePoints,
      rawPoints: largeRoutePoints,
      rawCells: largeRoutePoints,
    },
  },
}, 'large-route-debug'));
const largeDebugAgent = fakeRoom.state.agents.get('agent-large-route-debug');
assert.ok(
  JSON.stringify(JSON.parse(largeDebugAgent.visualStateJson || '{}')).length <= MAX_VISUAL_STATE_JSON_CHARS,
  'oversized route debug payloads should be trimmed instead of crashing the realtime room',
);

const pingPongDataDir = mkdtempSync(join(tmpdir(), 'vw-runtime-pingpong-slots-'));
mkdirSync(join(pingPongDataDir, 'buildings'), { recursive: true });
writeFileSync(join(pingPongDataDir, 'buildings', 'ping-office.json'), JSON.stringify({
  id: 'ping-office',
  type: 'office',
  worldX: 0,
  worldY: 0,
  widthTiles: 12,
  heightTiles: 12,
  interior: {
    walls: [],
    furniture: [{
      type: 'pingpong',
      x: 6,
      z: 6,
      floor: 1,
      actionLocations: [
        {
          id: 'player-left',
          interactionSpotId: 'player-left',
          activationSpotId: 'player-left',
          actionId: 'life.playPingPong',
          roles: ['use'],
          floor: 1,
          coordinateSpace: 'building-local',
          actionTarget: { x: 4.18, z: 6, floor: 1, facing: 'east' },
          activationTarget: { x: 4.18, z: 6, floor: 1, facing: 'east' },
        },
        {
          id: 'player-right',
          interactionSpotId: 'player-right',
          activationSpotId: 'player-right',
          actionId: 'life.playPingPong',
          roles: ['use'],
          floor: 1,
          coordinateSpace: 'building-local',
          actionTarget: { x: 7.82, z: 6, floor: 1, facing: 'west' },
          activationTarget: { x: 7.82, z: 6, floor: 1, facing: 'west' },
        },
        {
          id: 'watch-side',
          interactionSpotId: 'watch-side',
          activationSpotId: 'watch-side',
          actionId: 'life.watchPingPong',
          roles: ['watch'],
          capacity: { kind: 'queue', maxAgents: 2, reservable: true },
          floor: 1,
          coordinateSpace: 'building-local',
          actionTarget: { x: 6, z: 7.05, floor: 1, facing: 'north' },
          activationTarget: { x: 6, z: 7.05, floor: 1, facing: 'north' },
        },
      ],
    }],
  },
}, null, 2));

const pingPongTargets = listScriptedObjectRuntimeTargets(pingPongDataDir)
  .filter(target => target.objectType === 'pingpong');
assert.equal(
  pingPongTargets.length,
  0,
  `generic scripted-object runtime must not expose ping-pong slots; dedicated server-pingpong-runtime owns the whole game: ${JSON.stringify(pingPongTargets)}`,
);

const pingPongNow = Date.now();
const pingPongRoom = makeFakeRuntimeRoom(pingPongDataDir);
pingPongRoom.serverPingPongMatches = new Map();
pingPongRoom.serverPingPongCooldowns = new Map();
pingPongRoom.serverPingPongTableCooldowns = new Map();
pingPongRoom.serverPingPongTableTargets = [];
pingPongRoom.lastServerPingPongTablePollMs = 0;
const serverPingPongTables = pingPongRoom.loadServerPingPongTableTargets(pingPongNow, { force: true });
assert.equal(serverPingPongTables.length, 1, `dedicated server ping-pong runtime should discover the table: ${JSON.stringify(serverPingPongTables)}`);
const serverPingPongTable = serverPingPongTables[0];
assert.equal(serverPingPongTable.left?.slotId, 'player-left', 'dedicated server ping-pong runtime should expose player-left internally');
assert.equal(serverPingPongTable.right?.slotId, 'player-right', 'dedicated server ping-pong runtime should expose player-right internally');
const pingPongStart = pingPongRoom.startServerPingPongMatch(
  serverPingPongTable,
  'left-player',
  'right-player',
  pingPongNow,
  new Date(pingPongNow).toISOString(),
  { source: 'verify-server-pingpong' },
);
assert.equal(pingPongStart.changedSnapshots, 2, 'dedicated server ping-pong start should publish both player snapshots');
assert.equal(pingPongStart.changedObjects, 1, 'dedicated server ping-pong start should publish the table world object');
const serverPingPongLeft = snapshotToPlain(pingPongRoom.state.agents.get('left-player'));
const serverPingPongRight = snapshotToPlain(pingPongRoom.state.agents.get('right-player'));
assert.equal(serverPingPongLeft.owner, 'server-pingpong-runtime', 'left ping-pong player must be owned by dedicated server ping-pong runtime');
assert.equal(serverPingPongRight.owner, 'server-pingpong-runtime', 'right ping-pong player must be owned by dedicated server ping-pong runtime');
assert.equal(serverPingPongLeft.target?.targetKind, 'server-pingpong-player', 'left player should use dedicated server ping-pong target kind');
assert.equal(serverPingPongRight.target?.targetKind, 'server-pingpong-player', 'right player should use dedicated server ping-pong target kind');
assert.equal(JSON.parse(pingPongRoom.state.agents.get('left-player').visualStateJson || '{}').activity?.source, 'server-pingpong-runtime', 'left visual state should identify server ping-pong ownership');
assert.equal(JSON.parse(pingPongRoom.state.agents.get('right-player').visualStateJson || '{}').activity?.source, 'server-pingpong-runtime', 'right visual state should identify server ping-pong ownership');
const serverPingPongObject = worldObjectToPlain(pingPongRoom.state.objects.get(serverPingPongTable.objectKey));
assert.equal(serverPingPongObject.owner, 'server-pingpong-runtime', 'ping-pong table world object must be owned by dedicated server ping-pong runtime');
assert.equal(serverPingPongObject.data?.pingPongGame?.source, 'server-pingpong-runtime', 'published ping-pong game state must identify server ownership');
const serverPingPongMatch = pingPongRoom.serverPingPongMatches.get(serverPingPongTable.objectKey);
serverPingPongMatch.phase = 'result';
serverPingPongMatch.phaseStartedAtMs = pingPongNow + 50;
serverPingPongMatch.activeAtMs = pingPongNow;
serverPingPongMatch.p1SwingPulseId = 1;
serverPingPongMatch.p2SwingPulseId = 1;
pingPongRoom.advanceServerPingPongMatch(serverPingPongMatch, serverPingPongTable, 50, pingPongNow + 50, new Date(pingPongNow + 50).toISOString());
const serverPingPongResultVisual = JSON.parse(pingPongRoom.state.agents.get('left-player').visualStateJson || '{}');
assert.equal(serverPingPongResultVisual.resolvedAnimationId, 'idle', 'server ping-pong result hold must stop paddle animation before release');
assert.equal(serverPingPongResultVisual.activityActive, false, 'server ping-pong result hold must clear active paddle activity before release');
assert.equal(serverPingPongResultVisual.carrying, false, 'server ping-pong result hold must drop racket carry before release');
assert.ok(serverPingPongResultVisual.carriedItem == null, 'server ping-pong result hold must not publish a racket carried item');
assert.ok(serverPingPongResultVisual.pingPong == null, 'server ping-pong result hold must stop swing-pulse metadata before release');

const legacyPingPongTarget = {
  ...serverPingPongTable.left,
  objectKey: `${serverPingPongTable.objectKey}:slot:player-left`,
  baseObjectKey: serverPingPongTable.objectKey,
  objectType: 'pingpong',
  actionId: 'life.playPingPong',
  slotId: 'player-left',
  spotId: 'player-left',
  stayMs: 24000,
};
assert.throws(
  () => pingPongRoom.startServerScriptedObjectRoute('legacy-scripted-player', legacyPingPongTarget, pingPongNow, new Date(pingPongNow).toISOString(), { source: 'verify-legacy-pingpong', force: true }),
  error => error?.code === 'pingpong_server_runtime_required',
  'generic scripted-object runtime should reject ping-pong starts now that the dedicated server ping-pong runtime owns the game',
);

const legacyPingPongRoom = makeFakeRuntimeRoom(pingPongDataDir);
legacyPingPongRoom.loadScriptedObjectRuntimePlan = () => ({ targets: [], idleAgentIds: new Set(['legacy-scripted-player']) });
legacyPingPongRoom.tickSocialConversations = () => 0;
legacyPingPongRoom.promoteFreeServerScriptedServiceQueues = () => ({ changedSnapshots: 0, changedObjects: 0, promotedCount: 0 });
legacyPingPongRoom.upsertSnapshot({
  agentId: 'legacy-scripted-player',
  mode: 'live',
  owner: 'server-scripted-object-runtime',
  x: legacyPingPongTarget.x,
  y: legacyPingPongTarget.y,
  floor: 1,
  buildingId: legacyPingPongTarget.buildingId,
  roomId: '',
  heading: legacyPingPongTarget.faceAngle || 0,
  state: 'routing',
  routeId: 'legacy-pingpong-route',
  target: legacyPingPongTarget,
  leaseOwner: 'server-scripted-object',
  leaseExpiresAt: new Date(pingPongNow + 60000).toISOString(),
  visualState: { activityActive: true, activity: { kind: 'pingpong-left', objectType: 'pingpong' } },
}, 'verify-legacy-scripted-pingpong');
legacyPingPongRoom.upsertWorldObject({
  objectKey: legacyPingPongTarget.objectKey,
  owner: 'server-scripted-object-runtime',
  objectType: 'pingpong',
  buildingId: legacyPingPongTarget.buildingId,
  furnitureIndex: legacyPingPongTarget.furnitureIndex,
  state: 'routing',
  agentId: 'legacy-scripted-player',
  actionId: 'life.playPingPong',
  reservationId: 'legacy-pingpong-res',
  activeUseId: '',
  slotId: 'player-left',
  expiresAt: new Date(pingPongNow + 60000).toISOString(),
  data: { reservation: { agentId: 'legacy-scripted-player' } },
}, 'verify-legacy-scripted-pingpong-object');
legacyPingPongRoom.tickScriptedObjectRuntime(100, pingPongNow + 100, new Date(pingPongNow + 100).toISOString());
const legacyPingPongReleasedObject = worldObjectToPlain(legacyPingPongRoom.state.objects.get(legacyPingPongTarget.objectKey));
assert.equal(legacyPingPongReleasedObject.state, 'idle', 'legacy scripted ping-pong world object should be cleared on the next scripted runtime tick');

console.log('verify-server-runtime-collision-guards: OK');
