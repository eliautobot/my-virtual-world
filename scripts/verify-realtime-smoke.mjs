#!/usr/bin/env node
// End-to-end smoke test for the Colyseus agent runtime sidecar.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, getStateCallbacks } from '@colyseus/sdk';
import { Encoder } from '@colyseus/schema';
import {
  createAgentRuntimeClient,
  resolveRuntimeUrlForPage,
} from '../src/client/js/agent-runtime-client.mjs';
import {
  CONSUMABLE_SURFACE_SPECS,
} from '../src/client/js/consumable-surface-specs.mjs';
import {
  AGENT_RUNTIME_ROOM_NAME,
  AgentRuntimeSnapshot,
  AgentRuntimeState,
  applySnapshotPlainToSchema,
  appendRuntimeLifecycleJournal,
  buildScriptedObjectRuntimePlan,
  buildServerScriptedConsumeSpatialIndex,
  DEFAULT_WORLD_RUNTIME_TICK_MS,
  LIVE_ACTION_RUNTIME_POLL_MS,
  LIVE_STATUS_RUNTIME_POLL_MS,
  LIVE_STATUS_RUNTIME_OWNER,
  LIVE_STATUS_RUNTIME_RUN_SPEED_UNITS_PER_SEC,
  makeLiveActionEmbodiedState,
  resolveScriptedObjectRuntimeTargetFromRequest,
  resolveObjectTargetPoint,
  resolveServerFurnitureSpotApiPoint,
  RUNTIME_SCHEMA_PATCH_RATE_MS,
  RUNTIME_HEALTH_BROADCAST_INTERVAL_MS,
  RUNTIME_LIFECYCLE_JOURNAL_SCHEMA_VERSION,
  RUNTIME_STATE_BROADCAST_INTERVAL_MS,
  readRuntimeDocument,
  isServerManualObjectOccupancyTarget,
  isServerAutomaticSeatApproachPreemptibleForManualDrop,
  isServerScriptedObjectTargetAvailable,
  listScriptedObjectRuntimeTargets,
  listServerScriptedConsumeSeatTargets,
  makeServerScriptedConsumeTarget,
  SERVER_MANUAL_OBJECT_OCCUPANCY_DWELL_MS,
  SERVER_MANUAL_TABLE_SEAT_DWELL_MS,
  SERVER_SCRIPTED_OBJECT_RUNTIME_POLL_MS,
  SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER,
  SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER,
  SERVER_SCRIPTED_OBJECT_RUNTIME_RUN_SPEED_UNITS_PER_SEC,
  SERVER_SCRIPTED_FRIDGE_FOOD_OPTIONS,
  SERVER_SCRIPTED_IDLE_INITIAL_DELAY_MS,
  SERVER_WORLD_TOPOLOGY_OWNER,
  serverRuntimeReleasePointForTarget,
  withServerManualObjectOccupancyDwell,
} from '../src/realtime/agent-runtime-room.mjs';

const root = process.cwd();

function verifyBrowserRelativeRuntimeUrl() {
  const makeWindow = (href) => {
    const location = new URL(href);
    return { location };
  };
  assert.equal(
    resolveRuntimeUrlForPage('ws://browser-host:8594', makeWindow('http://127.0.0.1:8593/')),
    'ws://127.0.0.1:8594',
    'automatic runtime URLs should use the loopback hostname used to open the app',
  );
  assert.equal(
    resolveRuntimeUrlForPage('ws://browser-host:8594', makeWindow('http://localhost:8593/')),
    'ws://localhost:8594',
    'automatic runtime URLs should preserve localhost access',
  );
  assert.equal(
    resolveRuntimeUrlForPage('ws://browser-host:8594', makeWindow('http://100.77.124.77:8593/')),
    'ws://100.77.124.77:8594',
    'automatic runtime URLs should follow a LAN or Tailnet page hostname',
  );
  assert.equal(
    resolveRuntimeUrlForPage('ws://browser-host:8594', makeWindow('https://office.example.test/')),
    'wss://office.example.test:8594',
    'automatic runtime URLs should upgrade to secure WebSockets on HTTPS pages',
  );
  assert.equal(
    resolveRuntimeUrlForPage('wss://runtime.example.test/realtime', makeWindow('https://office.example.test/')),
    'wss://runtime.example.test/realtime',
    'explicit remote runtime URLs should remain unchanged',
  );
}

function verifyLifecycleJournalRecovery() {
  const dataDir = mkdtempSync(join(tmpdir(), 'vw-realtime-journal-'));
  writeFileSync(join(dataDir, 'agent-runtime.json'), `${JSON.stringify({
    schemaVersion: 'agent-runtime/v1',
    worldId: 'journal-smoke',
    updatedAt: new Date(0).toISOString(),
    eventSeq: 1,
    worldRuntime: {},
    agents: {
      'journal-agent': { agentId: 'journal-agent', mode: 'scripted', x: 1, y: 2, state: 'idle', version: 1 },
    },
    objects: {},
    events: [],
  })}\n`);
  appendRuntimeLifecycleJournal(dataDir, {
    schemaVersion: RUNTIME_LIFECYCLE_JOURNAL_SCHEMA_VERSION,
    operation: 'agent-upsert',
    eventSeq: 2,
    at: '2026-01-01T00:00:02.000Z',
    entity: { agentId: 'journal-agent', mode: 'manual', owner: 'user-directed', x: 9, y: 4, state: 'idle', version: 2 },
    event: { seq: 2, type: 'snapshot', agentId: 'journal-agent', at: '2026-01-01T00:00:02.000Z', snapshotVersion: 2 },
  });
  const recovered = readRuntimeDocument(dataDir);
  assert.equal(recovered.eventSeq, 2, 'lifecycle journal should advance the recovered event sequence');
  assert.equal(recovered.agents['journal-agent']?.mode, 'manual', 'lifecycle journal should restore the latest durable agent state');
  assert.equal(recovered.agents['journal-agent']?.x, 9, 'lifecycle journal should restore the latest durable position attached to a transition');
  assert.equal(recovered.events.at(-1)?.seq, 2, 'lifecycle journal should restore the durable transition event');
  assert.equal(recovered.lifecycleJournalApplied, 1, 'lifecycle journal should replay each new transition once');
}

function verifyIncrementalSchemaPatchSize() {
  const visualState = { activity: { summary: 'v'.repeat(5000) } };
  const target = { route: Array.from({ length: 200 }, (_, index) => ({ x: index, y: index })) };
  const base = {
    agentId: 'schema-patch-probe',
    mode: 'scripted',
    owner: 'schema-patch-probe',
    x: 1,
    y: 2,
    floor: 1,
    buildingId: 'office',
    roomId: '',
    heading: 0,
    state: 'routing',
    target,
    visualState,
    routeId: 'route-probe',
    worldActionId: '',
    leaseOwner: 'schema-patch-probe',
    leaseExpiresAt: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    tickSeq: 1,
    simTimeMs: 100,
    tickMs: 100,
  };
  const state = new AgentRuntimeState();
  state.agents.set(base.agentId, applySnapshotPlainToSchema(new AgentRuntimeSnapshot(), base));
  const encoder = new Encoder(state);
  encoder.encodeAll();
  encoder.discardChanges();

  const stableSchema = state.agents.get(base.agentId);
  applySnapshotPlainToSchema(stableSchema, {
    ...base,
    x: 2,
    updatedAt: '2026-01-01T00:00:00.100Z',
    version: 2,
    tickSeq: 2,
    simTimeMs: 200,
  });
  assert.equal(state.agents.get(base.agentId), stableSchema, 'movement updates must preserve the agent Schema instance');
  const incrementalBytes = encoder.encode().length;
  encoder.discardChanges();

  state.agents.set(base.agentId, applySnapshotPlainToSchema(new AgentRuntimeSnapshot(), {
    ...base,
    x: 3,
    updatedAt: '2026-01-01T00:00:00.200Z',
    version: 3,
    tickSeq: 3,
    simTimeMs: 300,
  }));
  const replacementBytes = encoder.encode().length;
  encoder.discardChanges();

  assert(incrementalBytes < 128, `movement-only Schema patch should stay compact; received ${incrementalBytes} bytes`);
  assert(replacementBytes > incrementalBytes * 20, `replacement control should prove bulky JSON retransmission (${replacementBytes} vs ${incrementalBytes})`);
}

function verifyManualObjectOccupancyPolicy() {
  assert.equal(
    SERVER_MANUAL_OBJECT_OCCUPANCY_DWELL_MS,
    5 * 60 * 1000,
    'manual object occupancy should remain stable for five minutes unless the user moves or releases the agent',
  );
  for (const objectType of ['barberChair', 'bed', 'chair', 'diningTable', 'smallCafeTable', 'outdoorCafeTable', 'smallRoundMeetingTable', 'treadmill', 'trainingMat', 'outdoorExerciseStation']) {
    assert.equal(
      isServerManualObjectOccupancyTarget({
        objectType,
        manualDrop: true,
        isQueueUse: false,
      }),
      true,
      `${objectType} should receive protected manual occupancy`,
    );
  }
  for (const objectType of ['waterCooler', 'vending', 'countertopCoffeeMachine', 'fridge', 'sink', 'gymBench']) {
    assert.equal(
      isServerManualObjectOccupancyTarget({
        objectType,
        manualDrop: true,
        isQueueUse: false,
      }),
      false,
      `${objectType} should retain its finite transactional service lifecycle`,
    );
  }
  assert.equal(
    isServerManualObjectOccupancyTarget({
      objectType: 'barberChair',
      manualDrop: true,
      isQueueUse: true,
    }),
    false,
    'waiting in a barber queue must not be mistaken for active chair occupancy',
  );
  assert.equal(
    SERVER_MANUAL_TABLE_SEAT_DWELL_MS,
    20 * 1000,
    'manually placed table agents should complete a normal finite visit',
  );
  const normalizedTableSeat = withServerManualObjectOccupancyDwell({
    objectType: 'outdoorCafeTable',
    manualDrop: true,
    stayMs: SERVER_MANUAL_OBJECT_OCCUPANCY_DWELL_MS,
  }, { manualDrop: true });
  assert.equal(
    normalizedTableSeat.stayMs,
    SERVER_MANUAL_TABLE_SEAT_DWELL_MS,
    'outdoor cafe table seats must not inherit the generic five-minute manual furniture hold',
  );
  const normalizedChair = withServerManualObjectOccupancyDwell({
    objectType: 'chair',
    manualDrop: true,
    stayMs: 1000,
  }, { manualDrop: true });
  assert.equal(
    normalizedChair.stayMs,
    SERVER_MANUAL_OBJECT_OCCUPANCY_DWELL_MS,
    'non-table manual seating should retain the protected five-minute hold',
  );
}

function verifyAuthoredTableDismountPoint() {
  const dataDir = mkdtempSync(join(tmpdir(), 'vw-table-dismount-'));
  mkdirSync(join(dataDir, 'buildings'), { recursive: true });
  writeFileSync(join(dataDir, 'buildings', 'rotated-table-building.json'), `${JSON.stringify({
    id: 'rotated-table-building',
    x: 12,
    z: 8,
    rotation: 90,
    widthTiles: 20,
    heightTiles: 16,
    interior: {
      furniture: [{
        type: 'outdoorCafeTable',
        x: 7,
        z: 6,
        rotation: 270,
        floor: 1,
        actionLocations: [{
          id: 'approach-east',
          interactionSpotId: 'approach-east',
          activationSpotId: 'approach-east',
          roles: ['approach', 'staging', 'dismount', 'exit'],
          coordinateSpace: 'building-local',
          buildingLocal: { x: 9.06, z: 6 },
          actionTarget: { spotId: 'approach-east', x: 9.06, z: 6, floor: 1, facing: 'east' },
          activationTarget: { spotId: 'approach-east', x: 9.06, z: 6, floor: 1, facing: 'east' },
          facing: 'east',
          floor: 1,
        }],
      }],
    },
  }, null, 2)}\n`);
  const seat = { x: 300, y: 220, floor: 1, buildingId: 'rotated-table-building' };
  const release = serverRuntimeReleasePointForTarget(dataDir, {
    ...seat,
    objectType: 'outdoorCafeTable',
    furnitureIndex: 0,
    poseKind: 'seat',
    spotId: 'seat-east',
    slotId: 'seat-east',
    approachSpotId: 'approach-east',
    exitSpotId: 'approach-east',
    dismountSpotId: 'approach-east',
  }, seat);
  assert.equal(release?.spotId, 'approach-east', 'the explicit table exit must win even when it is also the route approach marker');
  assert(Math.hypot(release.x - seat.x, release.y - seat.y) > 1, 'the table exit must be spatially separate from the seat');
}

function verifyUnifiedConsumableDestinationPolicy() {
  const dataDir = mkdtempSync(join(tmpdir(), 'vw-consume-destination-'));
  mkdirSync(join(dataDir, 'buildings'), { recursive: true });
  writeFileSync(join(dataDir, 'buildings', 'consume-building.json'), `${JSON.stringify({
    id: 'consume-building',
    worldX: 0,
    worldY: 0,
    widthTiles: 30,
    heightTiles: 22,
    interior: {
      floors: 2,
      furniture: [
        { type: 'waterCooler', x: 2, z: 2, floor: 1, actionLocations: [{ id: 'use-front', dx: 0, dz: 0.72, floor: 1, facing: 'north', action: 'life.getWater', roles: ['use'] }] },
        { type: 'diningTable', x: 4, z: 2, floor: 1, actionLocations: [{ id: 'seat-west', slotId: 'seat-west', activationSpotId: 'seat-west', approachSpotId: 'approach-west', exitSpotId: 'approach-west', dx: -1.42, dz: 0, floor: 1, facing: 'east', action: 'life.eatAtDiningTable', roles: ['seat', 'use'] }] },
        { type: 'chair', x: 4, z: 3, floor: 2, actionLocations: [{ id: 'seat', dx: 0, dz: 0.16, floor: 2, facing: 'north', action: 'life.sitAtChair', roles: ['seat'] }] },
        { type: 'desk', x: 22, z: 16, floor: 2, actionLocations: [{ id: 'seat-work', dx: 0, dz: 0.8, floor: 2, facing: 'north', action: 'planning.workAtDesk', roles: ['seat', 'use', 'work'] }] },
      ],
    },
    outdoorArea: {
      nodes: [{ id: 'park-seat', type: 'parkBench', x: 5, z: 4, floor: 1, rotation: 90 }],
    },
  }, null, 2)}\n`);
  const allSeats = listServerScriptedConsumeSeatTargets(dataDir);
  assert(allSeats.some(target => target.objectType === 'diningTable' && target.floor === 1), 'consume index should include interior table seats');
  assert(allSeats.some(target => target.objectType === 'parkBench' && target.outdoorNodeId === 'park-seat'), 'consume index should include outdoor Park Bench seats');
  assert(allSeats.some(target => target.objectType === 'chair' && target.floor === 2), 'consume index should retain other-floor seats for queries on that floor');
  const sourceTarget = {
    objectKey: 'consume-building:furniture:0:waterCooler',
    baseObjectKey: 'consume-building:furniture:0:waterCooler',
    buildingId: 'consume-building',
    furnitureIndex: 0,
    objectType: 'waterCooler',
    activityKind: 'water-cooler-get-water',
    actionId: 'life.getWater',
    x: 2 * 40,
    y: 2.72 * 40,
    floor: 1,
  };
  const runtimeState = {
    agents: new Map([['consume-agent', { agentId: 'consume-agent', x: sourceTarget.x, y: sourceTarget.y, floor: 1, buildingId: 'consume-building', state: 'using' }]]),
    objects: new Map(),
  };
  const tableSeat = allSeats.find(target => target.objectType === 'diningTable');
  const tablePlan = { consumeSeatSpatialIndex: buildServerScriptedConsumeSpatialIndex([tableSeat]) };
  const tableTarget = makeServerScriptedConsumeTarget(dataDir, 'consume-agent', sourceTarget, 100000, runtimeState, tablePlan);
  assert.equal(tableTarget.consumeDestinationKind, 'table-seat', 'an available nearby table seat should be a consume option');
  assert.equal(tableTarget.consumePresentation, 'surface', 'table consume should place the item on a serving surface');
  assert.equal(tableTarget.objectKey, tableSeat.objectKey, 'table consume must preserve the exact seat slot key for contention');
  assert.equal(tableTarget.consumeSurfaceSpotId, 'serving:seat-west', 'table serving spots should be tied to the exact selected seat');
  assert.equal(tableTarget.consumeSurfaceHeight, CONSUMABLE_SURFACE_SPECS.diningTable.surfaceHeight, 'Dining Table consume must use the exact tabletop top');
  assert.equal(tableTarget.consumeSurfaceForwardOffset, CONSUMABLE_SURFACE_SPECS.diningTable.forwardOffset, 'Dining Table consume must use its authored serving reach');
  assert.equal(tableTarget.consumeSurfaceSideOffset, CONSUMABLE_SURFACE_SPECS.diningTable.sideOffset, 'Dining Table consume must retain its seat-relative serving offset');
  for (const type of ['diningTable', 'smallCafeTable', 'outdoorCafeTable', 'picnicTable', 'smallRoundMeetingTable']) {
    const candidate = {
      ...tableSeat,
      objectType: type,
      objectKey: `${tableSeat.objectKey}:${type}`,
      baseObjectKey: `${tableSeat.baseObjectKey || tableSeat.objectKey}:${type}`,
    };
    const target = makeServerScriptedConsumeTarget(dataDir, 'consume-agent', sourceTarget, 100000, runtimeState, {
      consumeSeatSpatialIndex: buildServerScriptedConsumeSpatialIndex([candidate]),
    });
    assert.equal(target.consumeSurfaceHeight, CONSUMABLE_SURFACE_SPECS[type].surfaceHeight, `${type} must use the exact authored tabletop height`);
    assert.equal(target.consumeSurfaceForwardOffset, CONSUMABLE_SURFACE_SPECS[type].forwardOffset, `${type} must use an authored serving reach`);
    assert.equal(target.consumeSurfaceSideOffset, CONSUMABLE_SURFACE_SPECS[type].sideOffset, `${type} must use an authored seat-relative side offset`);
  }
  const occupiedTableState = {
    agents: new Map([
      ['consume-agent', runtimeState.agents.get('consume-agent')],
      ['other-agent', { agentId: 'other-agent', x: tableSeat.x, y: tableSeat.y, floor: 1, buildingId: 'consume-building', state: 'using', owner: 'server-scripted-object-runtime', leaseExpiresAt: new Date(200000).toISOString(), targetJson: JSON.stringify(tableSeat) }],
    ]),
    objects: new Map(),
  };
  const occupiedTableTarget = makeServerScriptedConsumeTarget(dataDir, 'consume-agent', sourceTarget, 100000, occupiedTableState, tablePlan);
  assert.notEqual(occupiedTableTarget.objectKey, tableSeat.objectKey, 'an occupied exact table seat must not be selected by another agent');
  const standaloneSeat = allSeats.find(target => target.objectType === 'parkBench');
  const standalonePlan = { consumeSeatSpatialIndex: buildServerScriptedConsumeSpatialIndex([standaloneSeat]) };
  const standaloneTarget = makeServerScriptedConsumeTarget(dataDir, 'consume-agent', sourceTarget, 100000, runtimeState, standalonePlan);
  assert.equal(standaloneTarget.consumeDestinationKind, 'standalone-seat', 'an outdoor standalone seat should be a consume option');
  assert.equal(standaloneTarget.consumePresentation, 'handheld', 'standalone-seat consume must keep the item in hand');
  assert.equal(standaloneTarget.floor, 1, 'nearby consume seats must remain on the agent floor');
  const floorTwoChair = allSeats.find(target => target.objectType === 'chair');
  const wrongFloorPlan = { consumeSeatSpatialIndex: buildServerScriptedConsumeSpatialIndex([floorTwoChair]) };
  const wrongFloorTarget = makeServerScriptedConsumeTarget(dataDir, 'consume-agent', sourceTarget, 100000, runtimeState, wrongFloorPlan);
  assert.equal(wrongFloorTarget.consumeDestinationKind, 'desk', 'an overlapping X/Z seat on another building floor must not count as nearby');
  const floorOnePlan = buildScriptedObjectRuntimePlan(dataDir);
  assert(floorOnePlan.consumeSeatSpatialIndex instanceof Map, 'the runtime plan should cache consume seats in a spatial index');
  const emptySeatPlan = { consumeSeatSpatialIndex: buildServerScriptedConsumeSpatialIndex([]) };
  const deskTarget = makeServerScriptedConsumeTarget(dataDir, 'consume-agent', sourceTarget, 100000, runtimeState, emptySeatPlan);
  assert.equal(deskTarget.consumeDestinationKind, 'desk', 'the assigned desk should remain the fallback when no nearby seat is available');
  assert.equal(deskTarget.consumePresentation, 'surface', 'desk consume should retain surface placement');
  assert.equal(deskTarget.consumeSurfaceHeight, CONSUMABLE_SURFACE_SPECS.desk.surfaceHeight, 'desk fallback must carry its exact desktop top height');
}

async function getOpenPort() {
  const net = await import('node:net');
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function startServer({ port, dataDir }) {
  const child = spawn(process.execPath, ['src/realtime/server.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      VW_REALTIME_PORT: String(port),
      VW_REALTIME_HOST: '127.0.0.1',
      VW_DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  return { child, get output() { return output; } };
}

async function stopServer(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  server.child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.child.once('exit', resolve)),
    delay(3000).then(() => {
      if (server.child.exitCode === null) server.child.kill('SIGKILL');
    }),
  ]);
}

async function waitForHealth(port, server) {
  const url = `http://127.0.0.1:${port}/healthz`;
  const deadline = Date.now() + 8000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch (error) {
      lastError = error;
    }
    if (server.child.exitCode !== null) {
      throw new Error(`realtime server exited early\n${server.output}`);
    }
    await delay(100);
  }
  throw new Error(`timed out waiting for ${url}: ${lastError?.message || 'no response'}\n${server.output}`);
}

async function verifyCorsPreflight(port) {
  const response = await fetch(`http://127.0.0.1:${port}/matchmake/joinOrCreate/${AGENT_RUNTIME_ROOM_NAME}`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://127.0.0.1:8587',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:8587');
  assert.match(response.headers.get('access-control-allow-methods') || '', /POST/);
}

async function connectIncrementalRuntimeClient(port) {
  return createAgentRuntimeClient({
    fetchImpl: async () => ({
      async json() {
        return {
          realtime: {
            enabled: true,
            url: `ws://127.0.0.1:${port}`,
            room: AGENT_RUNTIME_ROOM_NAME,
          },
        };
      },
    }),
    windowRef: {
      location: {
        href: `http://127.0.0.1:${port}/`,
        hostname: '127.0.0.1',
        protocol: 'http:',
      },
      Colyseus: { Client, getStateCallbacks },
    },
    logger: { warn() {} },
  });
}

function waitForRoomMessage(room, type, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const lastError = room.__runtimeErrors?.[room.__runtimeErrors.length - 1] || null;
      reject(new Error(`timed out waiting for ${type}${lastError ? `; last runtime error: ${JSON.stringify(lastError)}` : ''}`));
    }, 5000);
    const unregister = room.onMessage(type, (message) => {
      mergeRuntimeMessage(room, message);
      if (!predicate(message)) return;
      clearTimeout(timeout);
      unregister();
      resolve(message);
    });
  });
}

async function waitForAgent(room, agentId, predicate = () => true) {
  const deadline = Date.now() + Math.max(5000, Number(SERVER_SCRIPTED_IDLE_INITIAL_DELAY_MS?.[1] || 0) + 8000);
  let lastSeen = null;
  while (Date.now() < deadline) {
    const schemaAgent = room.state?.agents?.get?.(agentId);
    const runtimeAgent = room.__runtimeDoc?.agents?.[agentId];
    const agent = schemaAgent || (runtimeAgent
      ? {
          ...runtimeAgent,
          targetJson: runtimeAgent.target ? JSON.stringify(runtimeAgent.target) : '',
          visualStateJson: runtimeAgent.visualState ? JSON.stringify(runtimeAgent.visualState) : '',
        }
      : null);
    if (agent) {
      lastSeen = {
        agentId: agent.agentId,
        owner: agent.owner,
        leaseOwner: agent.leaseOwner,
        state: agent.state,
        x: agent.x,
        y: agent.y,
        targetJson: String(agent.targetJson || '').slice(0, 1800),
        visualStateJson: String(agent.visualStateJson || '').slice(0, 1200),
      };
    }
    if (agent && predicate(agent)) return agent;
    await delay(50);
  }
  const serverOutput = String(room.__server?.output || '').slice(-2000);
  throw new Error(`timed out waiting for agent ${agentId}${lastSeen ? `; last seen ${JSON.stringify(lastSeen)}` : ''}${serverOutput ? `; server output ${JSON.stringify(serverOutput)}` : ''}`);
}

function testWorldRuntimeFromDocument(doc) {
  const raw = doc?.worldRuntime;
  if (!raw || typeof raw !== 'object') return null;
  return {
    ...raw,
    trafficLights: new Map(Object.entries(raw.trafficLights || {})),
    trafficVehicles: new Map(Object.entries(raw.trafficVehicles || {})),
  };
}

function radiansClose(actual, expected, epsilon = 0.0001) {
  const fullTurn = Math.PI * 2;
  const delta = ((((Number(actual) - Number(expected) + Math.PI) % fullTurn) + fullTurn) % fullTurn) - Math.PI;
  return Math.abs(delta) < epsilon;
}

function assertRadiansClose(actual, expected, message) {
  assert(radiansClose(actual, expected), `${message}: expected ${expected}, got ${actual}`);
}

function verifyRotatedPersistedSeatFacings() {
  const dataDir = mkdtempSync(join(tmpdir(), 'vw-rotated-seats-'));
  mkdirSync(join(dataDir, 'buildings'), { recursive: true });
  const seatTypes = [
    ['loveseat', 'seat-left'],
    ['armchair', 'seat'],
    ['sectionalSofa', 'seat-center'],
    ['conferenceChair', 'seat'],
    ['hallwayBench', 'seat-left'],
    ['couch', 'sit-center'],
  ];
  const rotations = [
    [0, 'north', 0],
    [90, 'east', Math.PI / 2],
    [180, 'south', Math.PI],
    [270, 'west', -Math.PI / 2],
  ];
  const furniture = [];
  const expectations = [];
  for (const [type, spotId] of seatTypes) {
    for (const [rotation, facing, expectedAngle] of rotations) {
      const index = furniture.length;
      const x = 6 + (index % 4) * 12;
      const z = 6 + Math.floor(index / 4) * 8;
      furniture.push({
        type,
        x,
        z,
        floor: 1,
        rotation,
        actionLocations: [{
          id: spotId,
          spotId,
          slotId: spotId,
          actionId: 'life.sit',
          roles: ['seat', 'use'],
          facing,
          actionTarget: { x, z: z + 0.7, floor: 1, facing },
          activationTarget: { x, z, floor: 1, facing },
        }],
      });
      expectations.push({ index, type, spotId, rotation, expectedAngle });
    }
  }
  const buildingDocument = {
    id: 'rotated-seats',
    name: 'Rotated seating regression',
    type: 'office',
    worldX: 0,
    worldY: 0,
    widthTiles: 48,
    heightTiles: 56,
    interior: { furniture },
  };
  writeFileSync(join(dataDir, 'buildings', 'rotated-seats.json'), `${JSON.stringify(buildingDocument, null, 2)}\n`);

  const targets = listScriptedObjectRuntimeTargets(dataDir);
  for (const expectation of expectations) {
    const target = targets.find(candidate =>
      candidate.buildingId === 'rotated-seats' &&
      candidate.furnitureIndex === expectation.index &&
      candidate.slotId === expectation.spotId
    );
    assert.ok(
      target,
      `${expectation.type} at ${expectation.rotation} degrees should expose its authored seat target`,
    );
    assertRadiansClose(
      target.faceAngle,
      expectation.expectedAngle,
      `${expectation.type} at ${expectation.rotation} degrees must face with the placed object`,
    );
    if (expectation.type === 'sectionalSofa') {
      const release = serverRuntimeReleasePointForTarget(dataDir, target, {
        x: target.x,
        y: target.y,
        floor: target.floor,
        buildingId: target.buildingId,
      });
      const center = resolveServerFurnitureSpotApiPoint(
        buildingDocument,
        furniture[expectation.index],
        { dx: 0, dz: 0 },
      );
      assert.ok(release, `sectional sofa at ${expectation.rotation} degrees should have a safe dismount point`);
      assert.equal(release.spotId, 'dismount-center');
      const expectedDismountDistance = Math.hypot(0.40, 2.15) * 40;
      const actualDismountDistance = Math.hypot(release.x - center.apiX, release.y - center.apiZ);
      assert(
        Math.abs(actualDismountDistance - expectedDismountDistance) < 0.01,
        `sectional sofa at ${expectation.rotation} degrees must preserve its 2.15-tile front dismount clearance (${actualDismountDistance} vs ${expectedDismountDistance})`,
      );
    }
  }
}

async function waitForWorldRuntime(room, predicate = () => true) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const worldRuntime = room.state?.worldRuntime || testWorldRuntimeFromDocument(room.__runtimeDoc);
    if (worldRuntime && predicate(worldRuntime)) return worldRuntime;
    await delay(50);
  }
  throw new Error('timed out waiting for worldRuntime');
}

async function waitForObject(room, objectKey, predicate = () => true) {
  const deadline = Date.now() + Math.max(6000, Number(SERVER_SCRIPTED_IDLE_INITIAL_DELAY_MS?.[1] || 0) + 8000);
  while (Date.now() < deadline) {
    const schemaObject = room.state?.objects?.get?.(objectKey);
    const runtimeObject = room.__runtimeDoc?.objects?.[objectKey];
    const object = schemaObject || (runtimeObject
      ? {
          ...runtimeObject,
          dataJson: runtimeObject.data ? JSON.stringify(runtimeObject.data) : '',
        }
      : null);
    if (object && predicate(object)) return object;
    await delay(50);
  }
  throw new Error(`timed out waiting for object ${objectKey}`);
}

function ensureRuntimeDoc(room) {
  if (!room.__runtimeDoc || typeof room.__runtimeDoc !== 'object') {
    room.__runtimeDoc = { agents: {}, objects: {}, worldRuntime: null, events: [] };
  }
  if (!room.__runtimeDoc.agents || typeof room.__runtimeDoc.agents !== 'object') room.__runtimeDoc.agents = {};
  if (!room.__runtimeDoc.objects || typeof room.__runtimeDoc.objects !== 'object') room.__runtimeDoc.objects = {};
  return room.__runtimeDoc;
}

function mergeRuntimeMessage(room, message = null) {
  if (!message || typeof message !== 'object') return;
  const doc = ensureRuntimeDoc(room);
  const snapshot = message.snapshot || message.agent || message.event?.snapshot || null;
  if (snapshot?.agentId) doc.agents[snapshot.agentId] = snapshot;
  const object = message.object || message.worldObject || message.event?.object || null;
  if (object?.objectKey) doc.objects[object.objectKey] = object;
  const worldRuntime = message.worldRuntime || message.runtime || message.event?.worldRuntime || null;
  if (worldRuntime) doc.worldRuntime = worldRuntime;
}

async function connectRoom(port) {
  const client = new Client(`ws://127.0.0.1:${port}`);
  const room = await client.joinOrCreate(AGENT_RUNTIME_ROOM_NAME, { worldId: 'smoke' });
  room.__runtimeErrors = [];
  room.__runtimeMessageCounts = { events: 0, states: 0, welcomes: 0, worldRuntimes: 0 };
  room.onMessage('runtime:welcome', (message) => {
    room.__runtimeMessageCounts.welcomes++;
    room.__runtimeWelcome = message;
  });
  room.onMessage('runtime:event', (message) => {
    room.__runtimeMessageCounts.events++;
    mergeRuntimeMessage(room, message);
  });
  room.onMessage('runtime:ack', (message) => {
    mergeRuntimeMessage(room, message);
  });
  room.onMessage('runtime:error', (message) => {
    room.__runtimeErrors.push(message);
    if (room.__runtimeErrors.length > 12) room.__runtimeErrors.shift();
  });
  room.onMessage('runtime:state', (message) => {
    room.__runtimeMessageCounts.states++;
    if (message?.snapshot) room.__runtimeDoc = message.snapshot;
  });
  room.onMessage('runtime:worldRuntime', (message) => {
    room.__runtimeMessageCounts.worldRuntimes++;
    mergeRuntimeMessage(room, message);
    if (message?.worldRuntime && room.__runtimeDoc) {
      room.__runtimeDoc = { ...room.__runtimeDoc, worldRuntime: message.worldRuntime };
    }
  });
  room.onMessage('runtime:health', (message) => {
    room.__runtimeHealth = message;
  });
  return room;
}

async function run() {
  verifyBrowserRelativeRuntimeUrl();
  verifyLifecycleJournalRecovery();
  verifyIncrementalSchemaPatchSize();
  verifyManualObjectOccupancyPolicy();
  verifyAuthoredTableDismountPoint();
  verifyUnifiedConsumableDestinationPolicy();
  assert.equal(SERVER_SCRIPTED_FRIDGE_FOOD_OPTIONS.length, 10, 'server runtime must expose ten fridge foods');
  assert.equal(new Set(SERVER_SCRIPTED_FRIDGE_FOOD_OPTIONS.map(item => item.id)).size, 10, 'server fridge food ids must be unique');
  assert.equal(new Set(SERVER_SCRIPTED_FRIDGE_FOOD_OPTIONS.map(item => item.label)).size, 10, 'server fridge food labels must be unique');
  verifyRotatedPersistedSeatFacings();
  const dataDir = mkdtempSync(join(tmpdir(), 'vw-realtime-'));
  const port = await getOpenPort();
  let server = startServer({ port, dataDir });
  try {
    assert.equal(LIVE_ACTION_RUNTIME_POLL_MS, DEFAULT_WORLD_RUNTIME_TICK_MS, 'live action runtime should move at the world tick for smooth observer interpolation');
    assert.equal(LIVE_STATUS_RUNTIME_POLL_MS, DEFAULT_WORLD_RUNTIME_TICK_MS, 'live status runtime should move at the world tick for smooth observer interpolation');
    assert.equal(SERVER_SCRIPTED_OBJECT_RUNTIME_POLL_MS, DEFAULT_WORLD_RUNTIME_TICK_MS, 'scripted object runtime should move at the world tick for smooth observer interpolation');
    assert.equal(RUNTIME_STATE_BROADCAST_INTERVAL_MS, 0, 'full runtime-state broadcasts should be disabled in favor of schema patches');
    assert.equal(RUNTIME_HEALTH_BROADCAST_INTERVAL_MS, 2000, 'runtime health heartbeat should support visible-page stale detection');
    assert.equal(RUNTIME_SCHEMA_PATCH_RATE_MS, DEFAULT_WORLD_RUNTIME_TICK_MS, 'schema patches should stay at the world tick for smooth observer interpolation');
    assert.equal(LIVE_STATUS_RUNTIME_RUN_SPEED_UNITS_PER_SEC, 200, 'server-owned work routes should use the 8590 running displacement speed');
    assert.equal(SERVER_SCRIPTED_OBJECT_RUNTIME_RUN_SPEED_UNITS_PER_SEC, 200, 'server-owned desk-consume handoffs should use the 8590 running displacement speed');

    const health = await waitForHealth(port, server);
    assert.equal(health.ok, true);
    assert.equal(health.room, AGENT_RUNTIME_ROOM_NAME);
    await verifyCorsPreflight(port);

    const incrementalClient = await connectIncrementalRuntimeClient(port);
    try {
      assert.equal(incrementalClient.connected, true, 'browser runtime client should connect through the public SDK');
      const schemaSources = [];
      const unsubscribeIncremental = incrementalClient.onSnapshots((_snapshots, meta = {}) => {
        schemaSources.push(String(meta.source || ''));
      });
      const runtimeDeadline = Date.now() + 3000;
      while (!incrementalClient.worldRuntime && Date.now() < runtimeDeadline) await delay(25);
      assert(incrementalClient.worldRuntime, 'incremental callbacks should bind a world runtime that arrives after room join');
      const firstTickSeq = Number(incrementalClient.worldRuntime.tickSeq || 0);
      await delay(350);
      assert(Number(incrementalClient.worldRuntime?.tickSeq || 0) > firstTickSeq, 'incremental world-runtime metadata should advance with schema patches');
      assert(schemaSources.includes('schema:patch'), 'browser runtime client should receive incremental schema notifications');
      unsubscribeIncremental();
    } finally {
      incrementalClient.dispose();
    }

    const room = await connectRoom(port);
    room.__server = server;
    const runtimeHealth = await waitForRoomMessage(room, 'runtime:health');
    assert.equal(runtimeHealth.type, 'runtime-health', 'realtime sidecar should continuously prove connection health');
    assert(runtimeHealth.serverTime, 'runtime health should include authoritative server time');
    await delay(1100);
    assert.equal(room.__runtimeMessageCounts.welcomes, 1, 'rolling updates should send one compatibility welcome');
    assert.equal(room.__runtimeWelcome?.transport, 'schema', 'compatibility welcome should direct clients to schema state');
    assert.equal(room.__runtimeWelcome?.snapshot, undefined, 'compatibility welcome must not duplicate the runtime document');
    assert.equal(room.__runtimeMessageCounts.states, 0, 'steady state must not send full runtime documents');
    assert.equal(room.__runtimeMessageCounts.worldRuntimes, 0, 'steady state must not send redundant full world-runtime messages');
    room.send('runtime:snapshot', {
      requestId: 'snapshot-1',
      agentId: 'adam',
      mode: 'live',
      owner: 'agent-live-mode',
      x: 3.5,
      y: 4.25,
      floor: 1,
      state: 'idle',
      visualState: {
        schemaVersion: 'agent-runtime-visual/v1',
        status: 'idle',
        state: 'idle',
        movement: { isMoving: false, isRunning: false },
        activityActive: false,
        carrying: false,
      },
    });
    const snapshotAck = await waitForRoomMessage(room, 'runtime:ack', (msg) => msg.requestId === 'snapshot-1');
    assert.equal(snapshotAck.snapshot.agentId, 'adam');
    assert.equal(snapshotAck.snapshot.x, 3.5);
    assert.equal(snapshotAck.snapshot.visualState.status, 'idle');
    await waitForAgent(room, 'adam', (agent) => agent.x === 3.5 && agent.y === 4.25 && agent.visualStateJson.includes('agent-runtime-visual/v1'));

    room.send('runtime:worldObject', {
      requestId: 'object-1',
      objectKey: 'office:furniture:19:countertopCoffeeMachine',
      owner: 'main3d-world-runtime:smoke-client-a',
      objectType: 'countertopCoffeeMachine',
      buildingId: 'office',
      furnitureIndex: 19,
      state: 'active',
      agentId: 'adam',
      actionId: 'food.getCoffee',
      reservationId: 'coffee-res-1',
      activeUseId: 'coffee-active-1',
      slotId: 'use-front',
      expiresAt: new Date(Date.now() + 10000).toISOString(),
      data: {
        reservation: { id: 'coffee-res-1', agentId: 'adam', status: 'held', slotId: 'use-front' },
        activeUse: { id: 'coffee-active-1', state: 'active', agentId: 'adam', interactionSpotId: 'use-front' },
        activity: { kind: 'coffee-machine-brew', phase: 'active', objectKey: 'office:furniture:19:countertopCoffeeMachine' },
      },
    });
    const objectAck = await waitForRoomMessage(room, 'runtime:ack', (msg) => msg.requestId === 'object-1');
    assert.equal(objectAck.object.objectKey, 'office:furniture:19:countertopCoffeeMachine');
    assert.equal(objectAck.object.data.activeUse.state, 'active');

    room.send('runtime:worldObject', {
      requestId: 'object-conflict',
      objectKey: 'office:furniture:19:countertopCoffeeMachine',
      owner: 'main3d-world-runtime:smoke-client-b',
      state: 'active',
      agentId: 'beth',
      expiresAt: new Date(Date.now() + 10000).toISOString(),
      data: { activeUse: { state: 'active', agentId: 'beth' } },
    });
    const objectConflict = await waitForRoomMessage(room, 'runtime:error', (msg) => msg.requestId === 'object-conflict');
    assert.equal(objectConflict.code, 'object_state_conflict');

    room.send('runtime:worldTopology', {
      requestId: 'world-topology-1',
      owner: 'main3d-world-topology:smoke-client-a',
      topologyHash: 'traffic:smoke',
      tickMs: 500,
      trafficLights: [
        { key: 'traffic:0,0', ix: 0, iz: 0, type: 'x-int', openEdges: { n: true, s: true, e: true, w: true } },
        { key: 'traffic:1,0', ix: 1, iz: 0, type: 't-int', openEdges: { n: true, s: false, e: true, w: true } },
      ],
      trafficVehicles: Array.from({ length: 30 }, (_, index) => ({
        vehicleId: `traffic-vehicle:${index}`,
        vehicleType: index % 5 === 0 ? 'truck' : 'car',
        color: 12345 + index,
        x: 0,
        z: index * 2,
        dir: 0,
        speed: 10,
        speedMult: 1,
        path: [{ x: 0, z: index * 2 }, { x: 20, z: index * 2 }, { x: 20, z: 20 + index * 2 }],
        pathIdx: 1,
      })),
    });
    const topologyAck = await waitForRoomMessage(room, 'runtime:ack', (msg) => msg.requestId === 'world-topology-1');
    assert.equal(topologyAck.worldRuntime.schemaVersion, 'world-runtime/v1');
    assert.equal(Object.keys(topologyAck.worldRuntime.trafficLights).length, 2);
    assert.equal(Object.keys(topologyAck.worldRuntime.trafficVehicles).length, 30);
    assert.equal(topologyAck.worldRuntime.topologyHash, 'traffic:smoke');
    const firstWorldRuntime = await waitForWorldRuntime(room, (runtime) => runtime.trafficLights?.size === 2);
    const firstPhase = firstWorldRuntime.trafficLights.get('traffic:0,0').phaseMs;
    const firstVehicleX = firstWorldRuntime.trafficVehicles.get('traffic-vehicle:0').x;
    const firstTickSeq = firstWorldRuntime.tickSeq;
    const firstSimTimeMs = firstWorldRuntime.simTimeMs;
    const tickedWorldRuntime = await waitForWorldRuntime(room, (runtime) =>
      runtime.tickSeq > firstTickSeq &&
      runtime.trafficLights.get('traffic:0,0').phaseMs !== firstPhase &&
      runtime.trafficVehicles.get('traffic-vehicle:0').x !== firstVehicleX
    );
    assert.equal(tickedWorldRuntime.tickMs, DEFAULT_WORLD_RUNTIME_TICK_MS, 'persisted/browser 500ms world tick should normalize back to the server runtime cadence');
    assert(tickedWorldRuntime.simTimeMs > firstSimTimeMs);
    assert(tickedWorldRuntime.trafficVehicles.get('traffic-vehicle:0').x > firstVehicleX);

    room.send('runtime:claimRoute', {
      requestId: 'claim-1',
      agentId: 'adam',
      leaseOwner: 'smoke-client-a',
      routeId: 'route-smoke-1',
      target: { kind: 'world-point', x: 8, y: 9, floor: 1 },
      ttlMs: 10000,
    });
    const claimAck = await waitForRoomMessage(room, 'runtime:ack', (msg) => msg.requestId === 'claim-1');
    assert.equal(claimAck.snapshot.leaseOwner, 'smoke-client-a');

    room.send('runtime:claimRoute', {
      requestId: 'claim-conflict',
      agentId: 'adam',
      leaseOwner: 'smoke-client-b',
      routeId: 'route-smoke-2',
      ttlMs: 10000,
    });
    const conflict = await waitForRoomMessage(room, 'runtime:error', (msg) => msg.requestId === 'claim-conflict');
    assert.equal(conflict.code, 'lease_conflict');

    room.send('runtime:snapshot', {
      requestId: 'snapshot-during-lease',
      agentId: 'adam',
      x: 99,
      y: 99,
      floor: 1,
      state: 'idle',
    });
    const snapshotConflict = await waitForRoomMessage(room, 'runtime:error', (msg) => msg.requestId === 'snapshot-during-lease');
    assert.equal(snapshotConflict.code, 'lease_conflict');

    room.send('runtime:claimRoute', {
      requestId: 'claim-manual-agent',
      agentId: 'manual-agent',
      leaseOwner: 'smoke-client-route-owner',
      routeId: 'route-manual-agent',
      target: { kind: 'world-point', x: 20, y: 21, floor: 1 },
      ttlMs: 10000,
    });
    const manualClaimAck = await waitForRoomMessage(room, 'runtime:ack', (msg) => msg.requestId === 'claim-manual-agent');
    assert.equal(manualClaimAck.snapshot.leaseOwner, 'smoke-client-route-owner');

    room.send('runtime:snapshot', {
      requestId: 'manual-agent-conflict',
      agentId: 'manual-agent',
      x: 33,
      y: 34,
      floor: 1,
      state: 'idle',
    });
    const manualAgentConflict = await waitForRoomMessage(room, 'runtime:error', (msg) => msg.requestId === 'manual-agent-conflict');
    assert.equal(manualAgentConflict.code, 'lease_conflict');

    room.send('runtime:snapshot', {
      requestId: 'manual-agent-override',
      agentId: 'manual-agent',
      mode: 'manual',
      owner: 'user-directed:smoke-client-b',
      x: 33,
      y: 34,
      floor: 1,
      state: 'idle',
      routeId: '',
      worldActionId: '',
      target: null,
      leaseOwner: '',
      leaseExpiresAt: '',
    });
    const manualOverrideAck = await waitForRoomMessage(room, 'runtime:ack', (msg) => msg.requestId === 'manual-agent-override');
    assert.equal(manualOverrideAck.snapshot.mode, 'manual');
    assert.equal(manualOverrideAck.snapshot.owner, 'user-directed:smoke-client-b');
    assert.equal(manualOverrideAck.snapshot.leaseOwner, 'user-directed');
    assert(Date.parse(manualOverrideAck.snapshot.leaseExpiresAt) > Date.now());
    assert.equal(manualOverrideAck.snapshot.routeId, '');
    assert.equal(manualOverrideAck.snapshot.x, 33);

    room.send('runtime:claimRoute', {
      requestId: 'manual-agent-route-after-override',
      agentId: 'manual-agent',
      mode: 'manual',
      owner: 'user-directed:smoke-client-b',
      leaseOwner: 'smoke-client-route-owner',
      routeId: 'route-manual-agent-after-override',
      target: { kind: 'world-point', x: 35, y: 36, floor: 1 },
      ttlMs: 10000,
    });
    const manualRouteAfterOverrideAck = await waitForRoomMessage(room, 'runtime:ack', (msg) => msg.requestId === 'manual-agent-route-after-override');
    assert.equal(manualRouteAfterOverrideAck.snapshot.mode, 'manual');
    assert.equal(manualRouteAfterOverrideAck.snapshot.owner, 'user-directed:smoke-client-b');
    assert.equal(manualRouteAfterOverrideAck.snapshot.leaseOwner, 'smoke-client-route-owner');
    assert.equal(manualRouteAfterOverrideAck.snapshot.routeId, 'route-manual-agent-after-override');
    assert.equal(manualRouteAfterOverrideAck.snapshot.target.x, 35);

    room.send('runtime:heartbeat', {
      requestId: 'heartbeat-1',
      agentId: 'adam',
      leaseOwner: 'smoke-client-a',
      x: 7.5,
      y: 8.25,
      floor: 1,
      state: 'routing',
      visualState: {
        schemaVersion: 'agent-runtime-visual/v1',
        status: 'idle',
        state: 'routing',
        movement: { isMoving: true, isRunning: false },
        activityActive: true,
        activity: {
          kind: 'coffee-machine-brew',
          phase: 'active',
          furnitureType: 'countertopCoffeeMachine',
          faceAngle: 1.57,
        },
        carrying: true,
        carriedItem: {
          label: 'Coffee Drink',
          kind: 'coffee',
          visualKind: 'coffee',
          attachPoint: 'right-hand',
          state: 'carried',
          sourceFurnitureType: 'coffeeMachine',
        },
      },
      ttlMs: 10000,
    });
    const heartbeatAck = await waitForRoomMessage(room, 'runtime:ack', (msg) => msg.requestId === 'heartbeat-1');
    assert.equal(heartbeatAck.snapshot.x, 7.5);
    assert.equal(heartbeatAck.snapshot.visualState.activity.kind, 'coffee-machine-brew');
    assert.equal(heartbeatAck.snapshot.visualState.carriedItem.visualKind, 'coffee');
    await waitForAgent(room, 'adam', (agent) => agent.x === 7.5 && agent.state === 'routing' && agent.visualStateJson.includes('Coffee Drink'));

    room.send('runtime:releaseRoute', {
      requestId: 'release-1',
      agentId: 'adam',
      leaseOwner: 'smoke-client-a',
      state: 'idle',
      visualState: {
        schemaVersion: 'agent-runtime-visual/v1',
        status: 'idle',
        state: 'idle',
        movement: { isMoving: false, isRunning: false },
        activityActive: false,
        carrying: true,
        carriedItem: {
          label: 'Coffee Drink',
          kind: 'coffee',
          visualKind: 'coffee',
          attachPoint: 'right-hand',
          state: 'carried',
          sourceFurnitureType: 'coffeeMachine',
        },
      },
      reason: 'smoke-complete',
    });
    const releaseAck = await waitForRoomMessage(room, 'runtime:ack', (msg) => msg.requestId === 'release-1');
    assert.equal(releaseAck.snapshot.mode, 'scripted');
    assert.equal(releaseAck.snapshot.owner, 'agent-scripted-mode');
    assert.equal(releaseAck.snapshot.leaseOwner, '');
    assert.equal(releaseAck.snapshot.routeId, '');
    assert.equal(releaseAck.snapshot.worldActionId, '');
    assert.equal(releaseAck.snapshot.visualState.state, 'idle');
    assert.equal(releaseAck.snapshot.visualState.activityActive, false);
    assert.equal(releaseAck.snapshot.visualState.carriedItem.kind, 'coffee');

    room.send('runtime:claimRoute', {
      requestId: 'claim-stale',
      agentId: 'adam',
      leaseOwner: 'smoke-client-stale',
      routeId: 'route-stale-1',
      target: { kind: 'world-point', x: 10, y: 11, floor: 1 },
      ttlMs: 1000,
    });
    const staleClaimAck = await waitForRoomMessage(room, 'runtime:ack', (msg) => msg.requestId === 'claim-stale');
    assert.equal(staleClaimAck.snapshot.leaseOwner, 'smoke-client-stale');
    const expiredEvent = await waitForRoomMessage(room, 'runtime:event', (msg) => msg.type === 'route-lease-expired' && msg.agentId === 'adam');
    assert.equal(expiredEvent.expiredLeaseOwner, 'smoke-client-stale');
    const expiredAgent = await waitForAgent(room, 'adam', (agent) => agent.leaseOwner === '' && agent.routeId === '' && agent.state === 'idle');
    assert.equal(expiredAgent.mode, 'scripted');
    assert.equal(expiredAgent.owner, 'agent-scripted-mode');
    assert.equal(expiredAgent.worldActionId, '');

    writeFileSync(join(dataDir, 'world-meta.json'), `${JSON.stringify({
      agentProfiles: {
        adam: { agentLiveModeEnabled: true, scriptedAmbientEnabled: true },
      },
    }, null, 2)}\n`);
    room.send('runtime:claimRoute', {
      requestId: 'claim-live-idle-owner',
      agentId: 'adam',
      mode: 'live',
      owner: 'agent-live-mode',
      leaseOwner: 'smoke-client-live-owner',
      routeId: 'route-live-idle-owner',
      target: { kind: 'world-point', x: 12, y: 13, floor: 1 },
      ttlMs: 10000,
    });
    const liveClaimAck = await waitForRoomMessage(room, 'runtime:ack', (msg) => msg.requestId === 'claim-live-idle-owner');
    assert.equal(liveClaimAck.snapshot.mode, 'live');
    room.send('runtime:releaseRoute', {
      requestId: 'release-live-idle-owner',
      agentId: 'adam',
      leaseOwner: 'smoke-client-live-owner',
      state: 'idle',
      reason: 'live-mode-remains-authoritative',
    });
    const liveReleaseAck = await waitForRoomMessage(room, 'runtime:ack', (msg) => msg.requestId === 'release-live-idle-owner');
    assert.equal(liveReleaseAck.snapshot.mode, 'live');
    assert.equal(liveReleaseAck.snapshot.owner, 'agent-live-mode');
    assert.equal(liveReleaseAck.snapshot.leaseOwner, '');
    await room.leave(true);

    await stopServer(server);
    server = startServer({ port, dataDir });
    await waitForHealth(port, server);
    const resumedRoom = await connectRoom(port);
    resumedRoom.__server = server;
    const resumedAgent = await waitForAgent(resumedRoom, 'adam', (agent) => agent.x === 7.5 && agent.y === 8.25);
    assert.equal(resumedAgent.state, 'idle');
    assert.equal(resumedAgent.mode, 'live');
    assert.equal(resumedAgent.owner, 'agent-live-mode');
    assert(resumedAgent.visualStateJson.includes('Coffee Drink'));
    assert(resumedAgent.visualStateJson.includes('"activityActive":false'));
    const resumedObject = resumedRoom.state?.objects?.get?.('office:furniture:19:countertopCoffeeMachine');
    assert.equal(resumedObject?.state, 'active');
    assert(resumedObject?.dataJson.includes('coffee-active-1'));
    const resumedRuntime = await waitForWorldRuntime(resumedRoom, (runtime) => runtime.trafficLights?.size === 2);
    assert.equal(resumedRuntime.topologyHash, 'traffic:smoke');
    assert.equal(resumedRuntime.trafficVehicles?.size, 30);
    await resumedRoom.leave(true);

    mkdirSync(join(dataDir, 'buildings'), { recursive: true });
    writeFileSync(join(dataDir, 'world-meta.json'), `${JSON.stringify({
      agentProfiles: {
        // Adam is in Default Mode for the scripted-runtime parity section.
        // A Live-enabled resident is never eligible for this layer, even if a
        // stored ambient preference will resume after Live is disabled.
        adam: { agentLiveModeEnabled: false, scriptedAmbientEnabled: true },
      },
      streets: [
        { x1: -20, z1: 24, x2: 30, z2: 24 },
        { x1: 30, z1: 24, x2: 80, z2: 24 },
        { x1: 30, z1: -30, x2: 30, z2: 24 },
        { x1: 30, z1: 24, x2: 30, z2: 80 },
        { x1: 30, z1: 24, type: 'x-int', openEdges: { n: true, s: true, e: true, w: true } },
      ],
    }, null, 2)}\n`);
    writeFileSync(join(dataDir, 'presence-snapshot.json'), `${JSON.stringify({
      adam: { state: 'idle', agentLiveModeEnabled: false, scriptedAmbientEnabled: true },
      coder: { state: 'working' },
      morgan: { state: 'meeting' },
      _meetings: [{
        id: 'smoke-meeting',
        topic: 'Runtime parity',
        participants: ['morgan'],
      }],
    }, null, 2)}\n`);
    writeFileSync(join(dataDir, 'buildings', 'office.json'), `${JSON.stringify({
      id: 'office',
      name: 'Smoke Office',
      type: 'office',
      worldX: 0,
      worldY: 0,
      widthTiles: 20,
      heightTiles: 20,
      interior: {
        floors: [{ level: 1, name: 'Floor 1' }],
        furniture: [
          {
            type: 'armchair',
            x: 5,
            z: 5,
            floor: 1,
            room: 'lounge',
            actionLocations: [{
              id: 'seat',
              roles: ['seat', 'rest'],
              actionId: 'life.restAtArmchair',
              actionTarget: { x: 5.25, z: 5.25, floor: 1, faceAngle: Math.PI / 2 },
              facing: 'south',
            }],
          },
          {
            type: 'desk',
            x: 8,
            z: 5,
            floor: 1,
            room: 'office',
            actionLocations: [{
              id: 'work-front',
              roles: ['work', 'use'],
              actionId: 'work.desk',
              actionTarget: { x: 8, z: 5.8, floor: 1, faceAngle: Math.PI },
              facing: 'north',
            }],
          },
          {
            type: 'meetingTable',
            x: 11,
            z: 5,
            floor: 1,
            room: 'conference',
            actionLocations: [{
              id: 'seat-s3',
              roles: ['seat', 'meeting'],
              actionId: 'planning.meeting',
              actionTarget: { x: 11, z: 6.45, floor: 1, faceAngle: -Math.PI / 2 },
              facing: 'north',
            }],
          },
          {
            type: 'waterCooler',
            x: 14,
            z: 5,
            rotation: 90,
            floor: 1,
            room: 'breakroom',
            actionLocations: [{
              id: 'use-front',
              roles: ['use', 'drink'],
              actionId: 'life.getWater',
              actionTarget: { x: 14.92, z: 5, floor: 1, facing: 'east' },
              facing: 'east',
              transformApplied: { itemRotation: 90, buildingRotation: 0, totalRotation: 90 },
            }],
          },
          {
            type: 'checkoutCounter',
            x: 15,
            z: 9,
            floor: 1,
            room: 'shop',
            actionLocations: [
              {
                id: 'customer',
                roles: ['customer', 'use'],
                actionId: 'shop.checkout',
                actionTarget: { x: 15, z: 9.85, floor: 1, faceAngle: Math.PI },
                facing: 'north',
              },
              {
                id: 'queue',
                roles: ['queue', 'wait'],
                actionId: 'planning.schedule',
                capacityKind: 'queue',
                serviceQueue: true,
                actionTarget: { x: 15, z: 10.85, floor: 1, faceAngle: Math.PI },
                queueMaxPoints: 3,
                queueLocations: [
                  { id: 'queue:0', spotId: 'queue:0', actionTarget: { x: 15, z: 10.85, floor: 1, faceAngle: Math.PI }, queueIndex: 0 },
                  { id: 'queue:1', spotId: 'queue:1', actionTarget: { x: 15, z: 11.85, floor: 1, faceAngle: Math.PI }, queueIndex: 1 },
                  { id: 'queue:2', spotId: 'queue:2', actionTarget: { x: 15, z: 12.85, floor: 1, faceAngle: Math.PI }, queueIndex: 2 },
                ],
              },
            ],
          },
          {
            type: 'couch',
            x: 5,
            z: 12,
            floor: 1,
            room: 'lounge',
            actionLocations: [
              {
                id: 'stand-left',
                activationSpotId: 'stand-left',
                roles: ['approach', 'dismount', 'exit', 'stand', 'seat'],
                actionId: 'life.standFromCouch',
                actionTarget: { x: 4.05, z: 13.18, floor: 1, faceAngle: 0 },
                activationTarget: { x: 4.05, z: 13.18, floor: 1, faceAngle: 0 },
              },
              {
                id: 'stand-center',
                activationSpotId: 'stand-center',
                roles: ['approach', 'dismount', 'exit', 'stand', 'seat'],
                actionId: 'life.standFromCouch',
                actionTarget: { x: 5, z: 13.18, floor: 1, faceAngle: 0 },
                activationTarget: { x: 5, z: 13.18, floor: 1, faceAngle: 0 },
              },
              {
                id: 'stand-right',
                activationSpotId: 'stand-right',
                roles: ['approach', 'dismount', 'exit', 'stand', 'seat'],
                actionId: 'life.standFromCouch',
                actionTarget: { x: 5.95, z: 13.18, floor: 1, faceAngle: 0 },
                activationTarget: { x: 5.95, z: 13.18, floor: 1, faceAngle: 0 },
              },
              {
                id: 'sit-left',
                slotId: 'sit-left',
                activationSpotId: 'sit-left',
                approachSpotId: 'stand-left',
                roles: ['seat', 'rest', 'use'],
                actionId: 'life.sitAtCouch',
                actionTarget: { spotId: 'stand-left', x: 4.05, z: 13.18, floor: 1, faceAngle: 0 },
                activationTarget: { spotId: 'sit-left', x: 4.05, z: 12.44, floor: 1, faceAngle: 0 },
              },
              {
                id: 'sit-center',
                slotId: 'sit-center',
                activationSpotId: 'sit-center',
                approachSpotId: 'stand-center',
                roles: ['seat', 'rest', 'use'],
                actionId: 'life.restAtCouch',
                actionTarget: { spotId: 'stand-center', x: 5, z: 13.18, floor: 1, faceAngle: 0 },
                activationTarget: { spotId: 'sit-center', x: 5, z: 12.44, floor: 1, faceAngle: 0 },
              },
              {
                id: 'sit-right',
                slotId: 'sit-right',
                activationSpotId: 'sit-right',
                approachSpotId: 'stand-right',
                roles: ['seat', 'social', 'use'],
                actionId: 'life.socialAtCouch',
                actionTarget: { spotId: 'stand-right', x: 5.95, z: 13.18, floor: 1, faceAngle: 0 },
                activationTarget: { spotId: 'sit-right', x: 5.95, z: 12.44, floor: 1, faceAngle: 0 },
              },
              {
                id: 'talk-front',
                activationSpotId: 'talk-front',
                roles: ['social', 'staging', 'seat'],
                actionId: 'life.socialAtCouch',
                actionTarget: { x: 5, z: 13.58, floor: 1, faceAngle: 0 },
                activationTarget: { x: 5, z: 13.58, floor: 1, faceAngle: 0 },
              },
            ],
          },
          {
            type: 'fridge',
            x: 13,
            z: 15,
            floor: 1,
            room: 'breakroom',
            queuePolicy: 'first-come-first-served',
            actionLocations: [
              {
                id: 'use-front',
                activationSpotId: 'use-front',
                roles: ['use', 'retrieve', 'standing-use'],
                actionId: 'life.getFridgeSnack',
                actionTarget: { x: 13, z: 15.92, floor: 1, faceAngle: Math.PI },
                facing: 'north',
              },
              {
                id: 'door-swing-clearance',
                roles: ['clearance'],
                actionId: 'life.getFridgeSnack',
                capacityKind: 'clearance',
                actionTarget: { x: 13, z: 16.38, floor: 1, faceAngle: Math.PI },
                reservable: false,
              },
              {
                id: 'queue',
                roles: ['queue', 'wait', 'approach'],
                actionId: 'planning.schedule',
                capacityKind: 'queue',
                serviceQueue: true,
                actionTarget: { x: 13, z: 16.82, floor: 1, faceAngle: Math.PI },
                queueMaxPoints: 3,
                queueSpacingTiles: 0.8,
                queueLocations: [
                  { id: 'queue:0', spotId: 'queue:0', actionTarget: { x: 13, z: 16.82, floor: 1, faceAngle: Math.PI }, queueIndex: 0 },
                  { id: 'queue:1', spotId: 'queue:1', actionTarget: { x: 13, z: 17.62, floor: 1, faceAngle: Math.PI }, queueIndex: 1 },
                  { id: 'queue:2', spotId: 'queue:2', actionTarget: { x: 13, z: 18.42, floor: 1, faceAngle: Math.PI }, queueIndex: 2 },
                ],
              },
            ],
          },
          {
            type: 'diningTable',
            x: 6,
            z: 18,
            rotation: 90,
            floor: 1,
            room: 'dining',
            actionLocations: [
              {
                id: 'seat-north',
                slotId: 'seat-north',
                activationSpotId: 'seat-north',
                approachSpotId: 'approach-north',
                roles: ['seat', 'use', 'eat', 'social'],
                actionId: 'life.eatAtDiningTable',
                actionTarget: { spotId: 'approach-north', x: 4.24, z: 18, floor: 1 },
                activationTarget: { spotId: 'seat-north', x: 4.98, z: 18, floor: 1 },
              },
              {
                id: 'seat-south',
                slotId: 'seat-south',
                activationSpotId: 'seat-south',
                approachSpotId: 'approach-south',
                roles: ['seat', 'use', 'eat', 'social'],
                actionId: 'life.eatAtDiningTable',
                actionTarget: { spotId: 'approach-south', x: 7.76, z: 18, floor: 1 },
                activationTarget: { spotId: 'seat-south', x: 7.02, z: 18, floor: 1 },
              },
              {
                id: 'seat-east',
                slotId: 'seat-east',
                activationSpotId: 'seat-east',
                approachSpotId: 'approach-east',
                roles: ['seat', 'use', 'eat', 'social'],
                actionId: 'life.talkAtDiningTable',
                actionTarget: { spotId: 'approach-east', x: 6, z: 15.94, floor: 1 },
                activationTarget: { spotId: 'seat-east', x: 6, z: 16.58, floor: 1 },
              },
              {
                id: 'seat-west',
                slotId: 'seat-west',
                activationSpotId: 'seat-west',
                approachSpotId: 'approach-west',
                roles: ['seat', 'use', 'eat', 'social'],
                actionId: 'life.talkAtDiningTable',
                actionTarget: { spotId: 'approach-west', x: 6, z: 20.06, floor: 1 },
                activationTarget: { spotId: 'seat-west', x: 6, z: 19.42, floor: 1 },
              },
            ],
          },
        ],
      },
      outdoorArea: {
        nodes: [{
          id: 'smoke-gazebo-node',
          type: 'gazeboPavilion',
          catalogId: 'gazeboPavilion',
          x: 17,
          z: 14,
          floor: 1,
          actionLocations: [
            {
              id: 'rest-west',
              roles: ['rest', 'wait', 'use'],
              actionId: 'life.restAtGazeboPavilion',
              buildingLocal: { x: 16.22, z: 13.82, floor: 1 },
            },
            {
              id: 'sit-north-bench',
              roles: ['seat', 'rest', 'social'],
              actionId: 'life.sitAtGazeboPavilion',
              buildingLocal: { x: 17, z: 13.08, floor: 1 },
            },
          ],
        }],
      },
    }, null, 2)}\n`);

    const couchTargets = listScriptedObjectRuntimeTargets(dataDir)
      .filter(target => target.buildingId === 'office' && target.furnitureIndex === 5 && target.objectType === 'couch')
      .sort((a, b) => a.slotId.localeCompare(b.slotId));
    assert.deepEqual(
      couchTargets.map(target => target.slotId),
      ['sit-center', 'sit-left', 'sit-right'],
      'server runtime should expose all three couch cushions as independent seat slots',
    );
    assert.equal(
      new Set(couchTargets.map(target => target.objectKey)).size,
      3,
      'each couch cushion must receive its own authoritative world-object key',
    );
    assert(couchTargets.every(target => target.objectKey.endsWith(`:slot:${target.slotId}`)));
    assert(couchTargets.every(target => Math.abs(target.y - 12.44 * 40) < 0.01), 'automatic couch targets must end on the forward cushion docks, never the stand markers');
    assert(couchTargets.every(target => Math.abs(target.routeApproachTarget.y - 13.18 * 40) < 0.01), 'automatic couch routes must preserve the separate front stand approach');

    const diningTargets = listScriptedObjectRuntimeTargets(dataDir)
      .filter(target => target.buildingId === 'office' && target.furnitureIndex === 7 && target.objectType === 'diningTable')
      .sort((a, b) => a.slotId.localeCompare(b.slotId));
    assert.deepEqual(
      diningTargets.map(target => target.slotId),
      ['seat-east', 'seat-north', 'seat-south', 'seat-west'],
      'server runtime should expose all four dining chairs as independent seat slots',
    );
    assert.equal(new Set(diningTargets.map(target => target.objectKey)).size, 4, 'every dining chair must have its own world-object key');
    assert(diningTargets.every(target => target.objectKey.endsWith(`:slot:${target.slotId}`)));
    assert(diningTargets.every(target => target.poseKind === 'seat'), 'every dining chair target must use a seated pose');
    assert(diningTargets.every(target => {
      const expected = Math.atan2(6 * 40 - target.x, 18 * 40 - target.y);
      return Math.abs(Math.atan2(Math.sin(target.faceAngle - expected), Math.cos(target.faceAngle - expected))) < 0.0001;
    }), 'every rotated dining chair must face the current table center');
    assert(diningTargets.every(target => target.routeApproachTarget && Math.hypot(target.x - target.routeApproachTarget.x, target.y - target.routeApproachTarget.y) > 20), 'seat and approach targets must remain separate');
    const movedDiningEast = diningTargets.find(target => target.slotId === 'seat-east');
    const movedManualDiningTarget = resolveScriptedObjectRuntimeTargetFromRequest(dataDir, {
      manualDropSnapToUse: true,
      target: {
        ...movedDiningEast,
        x: movedDiningEast.x + 40,
        y: movedDiningEast.y + 80,
        faceAngle: -Math.PI / 3,
        routeApproachTarget: { ...movedDiningEast.routeApproachTarget, x: movedDiningEast.routeApproachTarget.x + 40, y: movedDiningEast.routeApproachTarget.y + 80 },
      },
    });
    assert.equal(movedManualDiningTarget.objectKey, movedDiningEast.objectKey, 'manual moved-table placement must retain the selected chair slot');
    assert.equal(movedManualDiningTarget.x, movedDiningEast.x + 40, 'manual moved-table placement must use the current seat x, not the saved approach x');
    assert.equal(movedManualDiningTarget.y, movedDiningEast.y + 80, 'manual moved-table placement must use the current seat y, not the saved approach y');
    assertRadiansClose(movedManualDiningTarget.faceAngle, -Math.PI / 3, 'manual moved/rotated table placement must preserve the current table-facing angle');

    const largeMeetingTargets = listScriptedObjectRuntimeTargets(dataDir)
      .filter(target => target.buildingId === 'office' && target.furnitureIndex === 2 && target.objectType === 'meetingTable');
    const largeMeetingSeatTargets = largeMeetingTargets.filter(target => target.slotId.startsWith('seat-'));
    const largeMeetingStandingTargets = largeMeetingTargets.filter(target => target.slotId.startsWith('stand-'));
    assert.equal(largeMeetingTargets.length, 16, 'old saved Meeting Tables must expose ten seats plus six overflow standing points');
    assert.equal(largeMeetingSeatTargets.length, 10, 'Meeting Table should expose ten independent seated slots');
    assert.equal(largeMeetingStandingTargets.length, 6, 'Meeting Table should expose six independent overflow standing slots');
    assert.equal(new Set(largeMeetingTargets.map(target => target.objectKey)).size, 16, 'every Meeting Table position must have a unique authoritative world-object key');
    assert(largeMeetingSeatTargets.every(target => target.poseKind === 'seat' && target.animationId === 'meeting-sit-talk'));
    assert(largeMeetingStandingTargets.every(target => target.poseKind === 'stand' && target.meetingStanding === true && target.animationId === 'gather-talk' && target.activityKind === 'meeting-table-stand'));
    assert(largeMeetingTargets.every(target => {
      const expected = Math.atan2(11 * 40 - target.x, 5 * 40 - target.y);
      return Math.abs(Math.atan2(Math.sin(target.faceAngle - expected), Math.cos(target.faceAngle - expected))) < 0.0001;
    }), 'every seated and standing Meeting Table target must face the current table center');

    const couchLeftTarget = couchTargets.find(target => target.slotId === 'sit-left');
    const couchCenterTarget = couchTargets.find(target => target.slotId === 'sit-center');
    const couchRightTarget = couchTargets.find(target => target.slotId === 'sit-right');
    const manualCenterTarget = resolveScriptedObjectRuntimeTargetFromRequest(dataDir, {
      target: {
        x: couchCenterTarget.x,
        y: couchCenterTarget.y,
        floor: couchCenterTarget.floor,
        buildingId: couchCenterTarget.buildingId,
        furnitureIndex: couchCenterTarget.furnitureIndex,
        objectType: 'couch',
        objectKey: couchCenterTarget.baseObjectKey,
        baseObjectKey: couchCenterTarget.baseObjectKey,
        spotId: 'sit-center',
        slotId: 'sit-center',
        actionId: 'life.sitAtCouch',
        activityKind: 'couch-sit',
        manualDrop: true,
      },
    });
    assert.equal(
      manualCenterTarget?.objectKey,
      couchCenterTarget.objectKey,
      'manual sit on the center cushion must retain the center per-seat object key even though its catalog action is rest',
    );
    assert.equal(
      manualCenterTarget?.actionId,
      'life.sitAtCouch',
      'manual center-seat resolution should preserve the explicitly chosen sit action',
    );
    const manualRightTarget = resolveScriptedObjectRuntimeTargetFromRequest(dataDir, {
      target: {
        x: couchRightTarget.x,
        y: couchRightTarget.y,
        floor: couchRightTarget.floor,
        buildingId: couchRightTarget.buildingId,
        furnitureIndex: couchRightTarget.furnitureIndex,
        objectType: 'couch',
        objectKey: couchRightTarget.baseObjectKey,
        baseObjectKey: couchRightTarget.baseObjectKey,
        spotId: 'sit-right',
        slotId: 'sit-right',
        actionId: 'life.sitAtCouch',
        activityKind: 'couch-sit',
        manualDrop: true,
      },
    });
    assert.equal(
      manualRightTarget?.objectKey,
      couchRightTarget.objectKey,
      'manual sit on the right cushion must retain the right per-seat object key even though its catalog action is socialize',
    );
    const couchSeatState = {
      objects: new Map(),
      agents: new Map([['couch-left-agent', {
        agentId: 'couch-left-agent',
        state: 'using',
        x: couchLeftTarget.x,
        y: couchLeftTarget.y,
        buildingId: couchLeftTarget.buildingId,
        targetJson: JSON.stringify(couchLeftTarget),
      }]]),
    };
    assert.equal(
      isServerScriptedObjectTargetAvailable(couchSeatState, couchLeftTarget, 'couch-second-agent', Date.now(), dataDir),
      false,
      'the occupied couch cushion must reject a second agent',
    );
    assert.equal(
      isServerScriptedObjectTargetAvailable(couchSeatState, couchRightTarget, 'couch-second-agent', Date.now(), dataDir),
      true,
      'occupying one couch cushion must leave the other cushion available',
    );
    const protectedManualRightTarget = {
      ...couchRightTarget,
      manualDrop: true,
      manualOccupancyHold: true,
      runtimeSource: 'manual-drag-drop:_useCouchFurniture',
    };
    const automaticRightApproachState = {
      objects: new Map(),
      agents: new Map([['automatic-couch-agent', {
        agentId: 'automatic-couch-agent',
        owner: SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER,
        state: 'routing',
        leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(),
        x: couchRightTarget.routeApproachTarget.x,
        y: couchRightTarget.routeApproachTarget.y,
        buildingId: couchRightTarget.buildingId,
        targetJson: JSON.stringify({ ...couchRightTarget, runtimeSource: 'idle' }),
      }]]),
    };
    assert.equal(
      isServerAutomaticSeatApproachPreemptibleForManualDrop(
        automaticRightApproachState,
        protectedManualRightTarget,
        'manual-couch-agent',
        Date.now(),
      ),
      true,
      'a manual couch drop must preempt an automatic agent that is only approaching the selected cushion',
    );
    automaticRightApproachState.agents.get('automatic-couch-agent').state = 'using';
    assert.equal(
      isServerAutomaticSeatApproachPreemptibleForManualDrop(
        automaticRightApproachState,
        protectedManualRightTarget,
        'manual-couch-agent',
        Date.now(),
      ),
      false,
      'a manual couch drop must not preempt an agent that is already seated',
    );
    automaticRightApproachState.agents.get('automatic-couch-agent').state = 'routing';
    automaticRightApproachState.agents.get('automatic-couch-agent').targetJson = JSON.stringify({
      ...couchRightTarget,
      manualDrop: true,
      manualOccupancyHold: true,
      runtimeSource: 'manual-drag-drop:_useCouchFurniture',
    });
    assert.equal(
      isServerAutomaticSeatApproachPreemptibleForManualDrop(
        automaticRightApproachState,
        protectedManualRightTarget,
        'manual-couch-agent',
        Date.now(),
      ),
      false,
      'one manual couch placement must never preempt another manual placement',
    );

    const gazeboTarget = {
      kind: 'object-instance',
      buildingId: 'office',
      objectInstanceId: 'smoke-gazebo-node',
      catalogId: 'gazeboPavilion',
      interactionSpotId: 'sit-north-bench',
      actionType: 'life.sitAtGazeboPavilion',
      floor: 1,
    };
    const gazeboPoint = resolveObjectTargetPoint(dataDir, gazeboTarget);
    assert(gazeboPoint, 'gazebo seated bench target should resolve');
    assert.equal(gazeboPoint.interactionSpotId, 'sit-north-bench');
    assert.equal(gazeboPoint.poseKind, 'seat', 'gazebo sit action must resolve seated posture instead of the standing rest pose');
    const gazeboEmbodied = makeLiveActionEmbodiedState(
      { id: 'wa-smoke-gazebo-seat', actionType: 'life.sitAtGazeboPavilion', target: gazeboTarget },
      { ...gazeboPoint, targetKind: 'object-instance' },
      'completed',
    );
    assert.equal(gazeboEmbodied.seated, true);
    assert.equal(gazeboEmbodied.posture, 'seated');
    assert.equal(gazeboEmbodied.interactionSpotId, 'sit-north-bench');

    const scriptedRoom = await connectRoom(port);
    scriptedRoom.__server = server;
    const serverRuntime = await waitForWorldRuntime(scriptedRoom, (runtime) =>
      runtime.topologyOwner === SERVER_WORLD_TOPOLOGY_OWNER && runtime.trafficLights?.size >= 1
    );
    assert.equal(serverRuntime.topologyOwner, SERVER_WORLD_TOPOLOGY_OWNER);
    assert.equal(serverRuntime.tickMs, DEFAULT_WORLD_RUNTIME_TICK_MS, 'server-owned runtime should advertise the active 100ms tick cadence');
    assert.equal(serverRuntime.trafficLights?.size, 1);
    assert(serverRuntime.trafficVehicles?.size > 0);
    scriptedRoom.send('runtime:worldTopology', {
      requestId: 'browser-topology-after-server-owner',
      owner: 'main3d-world-topology:browser-smoke',
      topologyHash: 'traffic:browser-should-not-own',
      trafficLights: [
        { key: 'traffic:99,99', ix: 99, iz: 99, type: 'x-int', openEdges: { n: true, s: true, e: true, w: true } },
      ],
      trafficVehicles: [],
    });
    const browserTopologyAck = await waitForRoomMessage(scriptedRoom, 'runtime:ack', (msg) => msg.requestId === 'browser-topology-after-server-owner');
    assert.equal(browserTopologyAck.worldRuntime.topologyOwner, SERVER_WORLD_TOPOLOGY_OWNER);
    assert.equal(browserTopologyAck.event.type, 'world-topology-skipped-server-authoritative');

    const scriptedAgent = await waitForAgent(scriptedRoom, 'adam', (agent) =>
      agent.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER ||
      agent.leaseOwner === SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER
    );
    assert.equal(scriptedAgent.owner, SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER);
    assert.equal(scriptedAgent.leaseOwner, SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER);
    assert(scriptedAgent.visualStateJson.includes('runtimeRoute'));
    assert(scriptedAgent.visualStateJson.includes('"routePoints"'), 'server scripted route should expose route points for browser debug overlays');
    assert(scriptedAgent.visualStateJson.includes('"rawPoints"'), 'server scripted route should expose raw preview points for browser debug overlays');
    assert(
      scriptedAgent.visualStateJson.includes('dynamic-interior-routing.js') ||
      scriptedAgent.visualStateJson.includes('dynamic-exterior-routing.js') ||
      scriptedAgent.visualStateJson.includes('server-door-transition')
    );
    assert(Math.abs(Number(scriptedAgent.heading || 0)) <= Math.PI + 0.00001, 'server scripted runtime heading should be radians');
    assert(scriptedAgent.visualStateJson.includes('"activityActive":true'), 'server scripted routing should hydrate activity while moving');
    assert(scriptedAgent.visualStateJson.includes('"defaultScriptedIdlePulse":true'), 'server scripted routing should identify VO-style idle pulse activity');
    const scriptedTarget = JSON.parse(scriptedAgent.targetJson || '{}');
    assert(scriptedTarget.objectKey, 'server scripted runtime should carry target object key');
    assert(Math.abs(Number(scriptedTarget.faceAngle || 0)) <= Math.PI, 'server scripted target faceAngle should be radians');
    if (scriptedTarget.objectKey === 'office:furniture:0:armchair') {
      assertRadiansClose(scriptedTarget.faceAngle, Math.PI / 2, 'authored armchair faceAngle should be preserved');
    }
    const scriptedObjectKey = scriptedTarget.objectKey;
    const scriptedObject = await waitForObject(scriptedRoom, scriptedObjectKey, (object) => object.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER);
    assert.equal(scriptedObject.agentId, 'adam');
    assert(['routing', 'active'].includes(scriptedObject.state));

    const workAgent = await waitForAgent(scriptedRoom, 'coder', (agent) => agent.owner === LIVE_STATUS_RUNTIME_OWNER);
    assert(['routing', 'working'].includes(workAgent.state));
    assert(workAgent.visualStateJson.includes('live-status-work-desk'));
    if (workAgent.state === 'routing') {
      assert(workAgent.visualStateJson.includes('"isRunning":true'), 'work desk routes should advertise running movement while en route');
    }
    assert(Math.abs(Number(workAgent.heading || 0)) <= Math.PI + 0.00001, 'work runtime heading should be radians');
    const workTarget = JSON.parse(workAgent.targetJson || '{}');
    assertRadiansClose(workTarget.faceAngle, Math.PI, 'authored desk faceAngle should be preserved');
    const workObject = await waitForObject(scriptedRoom, 'office:furniture:1:desk', (object) => object.owner === LIVE_STATUS_RUNTIME_OWNER);
    assert.equal(workObject.agentId, 'coder');
    assert(['routing', 'active'].includes(workObject.state));
    const activeWorkAgent = await waitForAgent(scriptedRoom, 'coder', (agent) =>
      agent.owner === LIVE_STATUS_RUNTIME_OWNER &&
      agent.state === 'working' &&
      agent.visualStateJson.includes('"atDesk":true') &&
      agent.visualStateJson.includes('"animationId":"typing"') &&
      agent.visualStateJson.includes('"phase":"active"')
    );
    const activeWorkVisual = JSON.parse(activeWorkAgent.visualStateJson || '{}');
    assert.equal(activeWorkVisual.resolvedAnimationId, 'typing', 'work desk arrival should hydrate the typing animation for browser observers');
    assert.equal(activeWorkVisual.activity?.kind, 'live-status-work-desk');

    const meetingAgent = await waitForAgent(scriptedRoom, 'morgan', (agent) => agent.owner === LIVE_STATUS_RUNTIME_OWNER);
    assert(['routing', 'meeting'].includes(meetingAgent.state));
    assert(meetingAgent.visualStateJson.includes('live-status-meeting-table'));
    assert(Math.abs(Number(meetingAgent.heading || 0)) <= Math.PI + 0.00001, 'meeting runtime heading should be radians');
    const meetingTarget = JSON.parse(meetingAgent.targetJson || '{}');
    assertRadiansClose(meetingTarget.faceAngle, Math.PI, 'Meeting Table occupants should face the current table center');
    const meetingObject = await waitForObject(scriptedRoom, 'office:furniture:2:meetingTable', (object) => object.owner === LIVE_STATUS_RUNTIME_OWNER);
    assert.equal(meetingObject.agentId, 'morgan');
    assert(['routing', 'active'].includes(meetingObject.state));
    const activeRuntimeHealth = await waitForHealth(port, server);
    assert.equal(activeRuntimeHealth.ok, true, 'realtime health must respond while server-owned routes are active');

    scriptedRoom.send('runtime:worldObject', {
      requestId: 'server-object-browser-overwrite',
      objectKey: scriptedObjectKey,
      owner: 'main3d-world-runtime:second-browser',
      state: 'active',
      agentId: 'adam',
      expiresAt: new Date(Date.now() + 10000).toISOString(),
      data: { activeUse: { state: 'active', agentId: 'adam' } },
    });
    const serverObjectConflict = await waitForRoomMessage(scriptedRoom, 'runtime:error', (msg) => msg.requestId === 'server-object-browser-overwrite');
    assert.equal(serverObjectConflict.code, 'object_state_conflict');

    scriptedRoom.send('runtime:snapshot', {
      requestId: 'beth-backend-object-snapshot',
      agentId: 'beth',
      mode: 'scripted',
      owner: 'agent-scripted-mode',
      x: 40,
      y: 40,
      floor: 1,
      state: 'idle',
    });
    const bethSnapshotAck = await waitForRoomMessage(scriptedRoom, 'runtime:ack', (msg) => msg.requestId === 'beth-backend-object-snapshot');
    assert.equal(bethSnapshotAck.snapshot.agentId, 'beth');
    scriptedRoom.send('runtime:objectUseRequest', {
      requestId: 'beth-backend-object-use',
      agentId: 'beth',
      source: 'smoke-manual-object-use',
      target: {
        objectKey: 'manual-building:furniture:2:waterCooler',
        buildingId: 'manual-building',
        furnitureIndex: 2,
        objectType: 'waterCooler',
        actionId: 'life.getWater',
        spotId: 'use-front',
        x: 96,
        y: 104,
        floor: 1,
        faceAngle: -Math.PI / 3,
        stayMs: 1200,
        consumeDurationMs: 1200,
      },
      agentPosition: { x: 40, y: 40, floor: 1 },
    });
    const objectUseAck = await waitForRoomMessage(scriptedRoom, 'runtime:ack', (msg) => msg.requestId === 'beth-backend-object-use');
    assert.equal(objectUseAck.type, 'runtime:objectUseRequest');
    assert.equal(objectUseAck.snapshot.owner, SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER);
    assert(Math.abs(Number(objectUseAck.snapshot.heading || 0)) <= Math.PI, 'manual backend object route heading should be radians');
    assertRadiansClose(objectUseAck.snapshot.target?.faceAngle, -Math.PI / 3, 'manual backend object faceAngle should remain radians');
    assert.equal(objectUseAck.object.owner, SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER);
    assert.equal(objectUseAck.object.objectKey, 'manual-building:furniture:2:waterCooler');
    const bethWaterDeskRoute = await waitForAgent(scriptedRoom, 'beth', (agent) =>
      agent.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER &&
      agent.visualStateJson.includes('water-desk-consume') &&
      agent.visualStateJson.includes('Water Cup') &&
      agent.visualStateJson.includes('"carrying":true')
    );
    assert(bethWaterDeskRoute.targetJson.includes('office:furniture:1:desk'), 'water handoff should target the work desk base object');
    const bethWaterDeskTarget = JSON.parse(bethWaterDeskRoute.targetJson || '{}');
    const bethWaterDeskVisual = JSON.parse(bethWaterDeskRoute.visualStateJson || '{}');
    if (bethWaterDeskTarget.runtimePhase === 'desk-routing') {
      assert(bethWaterDeskRoute.visualStateJson.includes('"isRunning":true'), 'water desk handoff should run while routing to desk');
    }
    assert.equal(bethWaterDeskTarget.sourceObjectKey, 'manual-building:furniture:2:waterCooler');
    assert.equal(bethWaterDeskVisual.carriedItem?.label, 'Water Cup');
    const bethWaterDeskActive = await waitForAgent(scriptedRoom, 'beth', (agent) =>
      agent.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER &&
      agent.visualStateJson.includes('water-desk-consume') &&
      agent.visualStateJson.includes('"phase":"active"') &&
      agent.visualStateJson.includes('"animationId":"water-desk-sip"') &&
      agent.visualStateJson.includes('"sipCountTarget":3') &&
      agent.visualStateJson.includes('"atDesk":true')
    );
    const bethWaterDeskActiveVisual = JSON.parse(bethWaterDeskActive.visualStateJson || '{}');
    assert.equal(bethWaterDeskActiveVisual.activity?.animationId, 'water-desk-sip');
    assert.equal(bethWaterDeskActiveVisual.activity?.phase, 'active');
    assert.equal(bethWaterDeskActiveVisual.activity?.temporaryItem?.label, 'Water Cup');
    assert(bethWaterDeskTarget.objectKey.endsWith(':consume:beth'), 'desk consume should use a transient per-agent object key');
    await waitForObject(scriptedRoom, 'manual-building:furniture:2:waterCooler', (object) =>
      object.state === 'idle' &&
      object.dataJson.includes('clearReservation')
    );
    const bethWaterDone = await waitForAgent(scriptedRoom, 'beth', (agent) =>
      agent.state === 'idle' &&
      agent.routeId === '' &&
      agent.visualStateJson.includes('"carrying":false') &&
      !agent.visualStateJson.includes('Water Cup')
    );
    assert.equal(bethWaterDone.owner, 'agent-scripted-mode');

    scriptedRoom.send('runtime:snapshot', {
      requestId: 'cora-backend-object-snapshot',
      agentId: 'cora',
      mode: 'scripted',
      owner: 'agent-scripted-mode',
      x: 36,
      y: 36,
      floor: 1,
      state: 'idle',
    });
    const coraSnapshotAck = await waitForRoomMessage(scriptedRoom, 'runtime:ack', (msg) => msg.requestId === 'cora-backend-object-snapshot');
    assert.equal(coraSnapshotAck.snapshot.agentId, 'cora');
    scriptedRoom.send('runtime:objectUseRequest', {
      requestId: 'cora-backend-vending-use',
      agentId: 'cora',
      source: 'smoke-manual-vending-use',
      target: {
        objectKey: 'manual-building:furniture:5:vending',
        buildingId: 'manual-building',
        furnitureIndex: 5,
        objectType: 'vending',
        actionId: 'life.buyVendingSnackDrink',
        spotId: 'use-front',
        x: 92,
        y: 106,
        floor: 1,
        faceAngle: -Math.PI / 4,
        vendingItemId: 'soft-drink-can-red',
        stayMs: 1200,
        consumeDurationMs: 1200,
      },
      agentPosition: { x: 36, y: 36, floor: 1 },
    });
    const vendingUseAck = await waitForRoomMessage(scriptedRoom, 'runtime:ack', (msg) => msg.requestId === 'cora-backend-vending-use');
    assert.equal(vendingUseAck.type, 'runtime:objectUseRequest');
    assert.equal(vendingUseAck.object.objectKey, 'manual-building:furniture:5:vending');
    const coraVendingDeskRoute = await waitForAgent(scriptedRoom, 'cora', (agent) =>
      agent.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER &&
      agent.visualStateJson.includes('vending-desk-consume') &&
      agent.visualStateJson.includes('vendingItemId') &&
      agent.visualStateJson.includes('"carrying":true')
    );
    const coraVendingDeskTarget = JSON.parse(coraVendingDeskRoute.targetJson || '{}');
    const coraVendingDeskVisual = JSON.parse(coraVendingDeskRoute.visualStateJson || '{}');
    if (coraVendingDeskTarget.runtimePhase === 'desk-routing') {
      assert(coraVendingDeskRoute.visualStateJson.includes('"isRunning":true'), 'vending desk handoff should run while routing to desk');
    }
    assert.equal(coraVendingDeskTarget.sourceObjectKey, 'manual-building:furniture:5:vending');
    assert.equal(coraVendingDeskVisual.carriedItem?.vendingItemId, 'soft-drink-can-red');
    const coraVendingDeskActive = await waitForAgent(scriptedRoom, 'cora', (agent) =>
      agent.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER &&
      agent.visualStateJson.includes('vending-desk-consume') &&
      agent.visualStateJson.includes('"phase":"active"') &&
      agent.visualStateJson.includes('"animationId":"vending-desk-consume"') &&
      agent.visualStateJson.includes('"sipCountTarget":3') &&
      agent.visualStateJson.includes('"atDesk":true')
    );
    const coraVendingDeskActiveVisual = JSON.parse(coraVendingDeskActive.visualStateJson || '{}');
    assert.equal(coraVendingDeskActiveVisual.activity?.animationId, 'vending-desk-consume');
    assert.equal(coraVendingDeskActiveVisual.activity?.phase, 'active');
    assert.equal(coraVendingDeskActiveVisual.activity?.temporaryItem?.vendingItemId, 'soft-drink-can-red');
    assert(coraVendingDeskTarget.objectKey.endsWith(':consume:cora'), 'vending desk consume should use a transient per-agent object key');
    await waitForObject(scriptedRoom, 'manual-building:furniture:5:vending', (object) =>
      object.state === 'idle' &&
      object.dataJson.includes('clearReservation')
    );
    const coraVendingDone = await waitForAgent(scriptedRoom, 'cora', (agent) =>
      agent.state === 'idle' &&
      agent.routeId === '' &&
      agent.visualStateJson.includes('"carrying":false') &&
      !agent.visualStateJson.includes('vendingItemId')
    );
    assert.equal(coraVendingDone.owner, 'agent-scripted-mode');

    // Keep the explicit three-agent fridge run deterministic after autonomous
    // scripted-idle coverage has completed.
    writeFileSync(join(dataDir, 'presence-snapshot.json'), `${JSON.stringify({
      adam: { state: 'idle', agentLiveModeEnabled: false, scriptedAmbientEnabled: false },
      coder: { state: 'working' },
      morgan: { state: 'meeting' },
      _meetings: [{
        id: 'smoke-meeting',
        topic: 'Runtime parity',
        participants: ['morgan'],
      }],
    }, null, 2)}\n`);
    await delay(750);

    const fridgeObjectKey = 'office:furniture:6:fridge';
    const fridgeQueueAgents = [
      ['fridge-manual-a', 480, 700, SERVER_SCRIPTED_FRIDGE_FOOD_OPTIONS[0]],
      ['fridge-manual-b', 500, 700, SERVER_SCRIPTED_FRIDGE_FOOD_OPTIONS[4]],
      ['fridge-manual-c', 520, 700, SERVER_SCRIPTED_FRIDGE_FOOD_OPTIONS[9]],
    ];
    for (const [agentId, x, y] of fridgeQueueAgents) {
      scriptedRoom.send('runtime:snapshot', {
        requestId: `${agentId}-seed`,
        agentId,
        mode: 'scripted',
        owner: 'agent-scripted-mode',
        x,
        y,
        floor: 1,
        state: 'idle',
      });
      await waitForRoomMessage(scriptedRoom, 'runtime:ack', (msg) => msg.requestId === `${agentId}-seed`);
    }
    const requestManualFridgeUse = (agentId, x, food) => {
      scriptedRoom.send('runtime:objectUseRequest', {
        requestId: `${agentId}-fridge-use`,
        agentId,
        source: 'manual-drag-drop-fridge-service-queue',
        manualDrop: true,
        manualDropSnapToUse: true,
        target: {
          objectKey: fridgeObjectKey,
          baseObjectKey: fridgeObjectKey,
          buildingId: 'office',
          furnitureIndex: 6,
          objectType: 'fridge',
          spotId: 'use-front',
          actionId: 'life.getFridgeSnack',
          activityKind: 'fridge-get-snack',
          animationId: 'fridge-use',
          fridgeFoodId: food.id,
          stayMs: 5000,
          consumeDurationMs: 1200,
          manualDrop: true,
          manualDropSnapToUse: true,
        },
        agentPosition: { x, y: 700, floor: 1 },
      });
    };
    requestManualFridgeUse(fridgeQueueAgents[0][0], fridgeQueueAgents[0][1], fridgeQueueAgents[0][3]);
    const fridgeManualA = await waitForRoomMessage(scriptedRoom, 'runtime:ack', (msg) => msg.requestId === 'fridge-manual-a-fridge-use');
    assert.equal(fridgeManualA.snapshot.state, 'using');
    assert.equal(fridgeManualA.snapshot.target?.spotId, 'use-front');
    assert.equal(fridgeManualA.snapshot.target?.manualDrop, true);
    assert.equal(fridgeManualA.snapshot.target?.manualDropSnapToUse, true);
    assert.equal(fridgeManualA.snapshot.target?.fridgeFoodId, SERVER_SCRIPTED_FRIDGE_FOOD_OPTIONS[0].id);
    assert.equal(fridgeManualA.snapshot.x, 13 * 40);
    assert.equal(fridgeManualA.snapshot.y, 15.92 * 40);

    requestManualFridgeUse(fridgeQueueAgents[1][0], fridgeQueueAgents[1][1], fridgeQueueAgents[1][3]);
    const fridgeManualBQueued = await waitForRoomMessage(scriptedRoom, 'runtime:ack', (msg) => msg.requestId === 'fridge-manual-b-fridge-use');
    assert.equal(fridgeManualBQueued.snapshot.state, 'waiting');
    assert.equal(fridgeManualBQueued.snapshot.target?.isQueueUse, true);
    assert.equal(fridgeManualBQueued.snapshot.target?.queueIndex, 0);
    assert.equal(fridgeManualBQueued.snapshot.target?.queuedUseFridgeFoodId, SERVER_SCRIPTED_FRIDGE_FOOD_OPTIONS[4].id);
    assert.equal(fridgeManualBQueued.snapshot.x, 13 * 40);
    assert.equal(fridgeManualBQueued.snapshot.y, 16.82 * 40);
    assert.equal(fridgeManualBQueued.snapshot.visualState?.activity?.animationId, 'bus-stop-wait');

    requestManualFridgeUse(fridgeQueueAgents[2][0], fridgeQueueAgents[2][1], fridgeQueueAgents[2][3]);
    const fridgeManualCQueued = await waitForRoomMessage(scriptedRoom, 'runtime:ack', (msg) => msg.requestId === 'fridge-manual-c-fridge-use');
    assert.equal(fridgeManualCQueued.snapshot.state, 'waiting');
    assert.equal(fridgeManualCQueued.snapshot.target?.isQueueUse, true);
    assert.equal(fridgeManualCQueued.snapshot.target?.queueIndex, 1);
    assert.equal(fridgeManualCQueued.snapshot.target?.queuedUseFridgeFoodId, SERVER_SCRIPTED_FRIDGE_FOOD_OPTIONS[9].id);
    assert.equal(fridgeManualCQueued.snapshot.x, 13 * 40);
    assert.equal(fridgeManualCQueued.snapshot.y, 17.62 * 40);

    const fridgeManualADesk = await waitForAgent(scriptedRoom, 'fridge-manual-a', (agent) =>
      agent.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER &&
      agent.visualStateJson.includes('fridge-desk-consume') &&
      agent.visualStateJson.includes(`"fridgeFoodId":"${SERVER_SCRIPTED_FRIDGE_FOOD_OPTIONS[0].id}"`) &&
      agent.visualStateJson.includes('"carrying":true')
    );
    const fridgeManualADeskTarget = JSON.parse(fridgeManualADesk.targetJson || '{}');
    const fridgeManualADeskVisual = JSON.parse(fridgeManualADesk.visualStateJson || '{}');
    assert.equal(fridgeManualADeskTarget.sourceObjectKey, fridgeObjectKey);
    assert.equal(fridgeManualADeskVisual.carriedItem?.label, SERVER_SCRIPTED_FRIDGE_FOOD_OPTIONS[0].label);
    assert(
      ['desk', 'table-seat', 'standalone-seat'].includes(fridgeManualADeskTarget.consumeDestinationKind),
      'fridge food must route through the unified desk/table/seat consume chooser',
    );
    assert(
      fridgeManualADeskTarget.consumeDestinationKind === 'standalone-seat'
        ? fridgeManualADeskTarget.consumePresentation === 'handheld'
        : fridgeManualADeskTarget.consumePresentation === 'surface',
      'fridge consume presentation must match its selected destination',
    );
    const fridgeManualAActive = await waitForAgent(scriptedRoom, 'fridge-manual-a', (agent) =>
      agent.visualStateJson.includes('fridge-desk-consume') &&
      agent.visualStateJson.includes('"phase":"active"') &&
      agent.visualStateJson.includes('"animationId":"fridge-desk-consume"') &&
      agent.visualStateJson.includes('"consumeDestinationKind"')
    );
    const fridgeManualAActiveVisual = JSON.parse(fridgeManualAActive.visualStateJson || '{}');
    assert.equal(fridgeManualAActiveVisual.activity?.temporaryItem?.fridgeFoodId, SERVER_SCRIPTED_FRIDGE_FOOD_OPTIONS[0].id);

    const fridgeManualBPromoted = await waitForAgent(scriptedRoom, 'fridge-manual-b', (agent) =>
      agent.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER &&
      agent.targetJson.includes(fridgeObjectKey) &&
      agent.targetJson.includes('"isQueueUse":false') &&
      agent.targetJson.includes(`"fridgeFoodId":"${SERVER_SCRIPTED_FRIDGE_FOOD_OPTIONS[4].id}"`) &&
      agent.visualStateJson.includes('fridge-get-snack')
    );
    assert(['routing', 'using'].includes(fridgeManualBPromoted.state));
    const fridgeManualCShifted = await waitForAgent(scriptedRoom, 'fridge-manual-c', (agent) =>
      agent.targetJson.includes('"isQueueUse":true') &&
      agent.targetJson.includes('"queueIndex":0') &&
      agent.targetJson.includes(`${fridgeObjectKey}:queue:queue:0`)
    );
    assert(['routing', 'waiting'].includes(fridgeManualCShifted.state));

    const fridgeManualCPromoted = await waitForAgent(scriptedRoom, 'fridge-manual-c', (agent) =>
      agent.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER &&
      agent.targetJson.includes(fridgeObjectKey) &&
      agent.targetJson.includes('"isQueueUse":false') &&
      agent.targetJson.includes(`"fridgeFoodId":"${SERVER_SCRIPTED_FRIDGE_FOOD_OPTIONS[9].id}"`) &&
      agent.visualStateJson.includes('fridge-get-snack')
    );
    assert(['routing', 'using'].includes(fridgeManualCPromoted.state));

    for (const [agentId] of fridgeQueueAgents) {
      const consumed = await waitForAgent(scriptedRoom, agentId, (agent) =>
        agent.state === 'idle' &&
        agent.routeId === '' &&
        agent.visualStateJson.includes('"carrying":false') &&
        !agent.visualStateJson.includes('fridgeFoodId')
      );
      assert.equal(consumed.owner, 'agent-scripted-mode');
    }
    const fridgeIdle = await waitForObject(scriptedRoom, fridgeObjectKey, (object) => {
      const reservations = object.data?._scriptedServiceQueueStore?.reservations || [];
      return object.state === 'idle' && object.activeUseId === '' && reservations.length === 0;
    });
    assert(fridgeIdle.dataJson.includes('"clearReservation":true'));

    for (const [agentId, x, y] of [
      ['queue-a', 560, 320],
      ['queue-b', 548, 324],
      ['queue-c', 536, 328],
    ]) {
      scriptedRoom.send('runtime:snapshot', {
        requestId: `${agentId}-checkout-queue-snapshot`,
        agentId,
        mode: 'scripted',
        owner: 'agent-scripted-mode',
        x,
        y,
        floor: 1,
        state: 'idle',
      });
      const queueSnapshotAck = await waitForRoomMessage(scriptedRoom, 'runtime:ack', (msg) => msg.requestId === `${agentId}-checkout-queue-snapshot`);
      assert.equal(queueSnapshotAck.snapshot.agentId, agentId);
    }
    scriptedRoom.send('runtime:objectUseRequest', {
      requestId: 'queue-a-checkout-use',
      agentId: 'queue-a',
      source: 'smoke-service-queue-use',
      target: {
        buildingId: 'office',
        furnitureIndex: 4,
        objectType: 'checkoutCounter',
        spotId: 'customer',
        stayMs: 1200,
      },
      agentPosition: { x: 560, y: 320, floor: 1 },
    });
    const queueAUseAck = await waitForRoomMessage(scriptedRoom, 'runtime:ack', (msg) => msg.requestId === 'queue-a-checkout-use');
    assert.equal(queueAUseAck.object.objectKey, 'office:furniture:4:checkoutCounter');
    for (const agentId of ['queue-b', 'queue-c']) {
      scriptedRoom.send('runtime:objectUseRequest', {
        requestId: `${agentId}-checkout-queue`,
        agentId,
        source: 'smoke-service-queue-wait',
        target: {
          buildingId: 'office',
          furnitureIndex: 4,
          objectType: 'checkoutCounter',
          spotId: 'queue',
        },
        agentPosition: { x: agentId === 'queue-b' ? 548 : 536, y: agentId === 'queue-b' ? 324 : 328, floor: 1 },
      });
      const queueAck = await waitForRoomMessage(scriptedRoom, 'runtime:ack', (msg) => msg.requestId === `${agentId}-checkout-queue`);
      assert.equal(queueAck.type, 'runtime:objectUseRequest');
      assert(queueAck.object.objectKey.includes('office:furniture:4:checkoutCounter:queue:queue:'), 'queued object use should claim a per-slot queue object');
    }
    const checkoutQueueBase = await waitForObject(scriptedRoom, 'office:furniture:4:checkoutCounter', (object) =>
      object.dataJson.includes('_scriptedServiceQueueStore') &&
      object.dataJson.includes('queue-b') &&
      object.dataJson.includes('queue-c')
    );
    assert(checkoutQueueBase.dataJson.includes('"queueIndex":0'));
    assert(checkoutQueueBase.dataJson.includes('"queueIndex":1'));
    const queueBWait = await waitForAgent(scriptedRoom, 'queue-b', (agent) =>
      agent.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER &&
      agent.state === 'waiting' &&
      agent.targetJson.includes('"isQueueUse":true') &&
      agent.targetJson.includes('"queueIndex":0') &&
      agent.visualStateJson.includes('service-queue-wait') &&
      agent.visualStateJson.includes('bus-stop-wait')
    );
    assert(queueBWait.targetJson.includes('office:furniture:4:checkoutCounter:queue:queue:0'));
    const queueCWait = await waitForAgent(scriptedRoom, 'queue-c', (agent) =>
      agent.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER &&
      agent.state === 'waiting' &&
      agent.targetJson.includes('"isQueueUse":true') &&
      agent.targetJson.includes('"queueIndex":1') &&
      agent.visualStateJson.includes('service-queue-wait')
    );
    assert(queueCWait.targetJson.includes('office:furniture:4:checkoutCounter:queue:queue:1'));
    const queueBPromoted = await waitForAgent(scriptedRoom, 'queue-b', (agent) =>
      agent.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER &&
      agent.targetJson.includes('office:furniture:4:checkoutCounter') &&
      agent.targetJson.includes('"isQueueUse":false') &&
      agent.visualStateJson.includes('checkout-counter-customer')
    );
    assert(['routing', 'using'].includes(queueBPromoted.state));
    const queueCShifted = await waitForAgent(scriptedRoom, 'queue-c', (agent) =>
      agent.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER &&
      agent.targetJson.includes('"isQueueUse":true') &&
      agent.targetJson.includes('"queueIndex":0') &&
      agent.targetJson.includes('office:furniture:4:checkoutCounter:queue:queue:0')
    );
    assert(['routing', 'waiting'].includes(queueCShifted.state));
    await waitForObject(scriptedRoom, 'office:furniture:4:checkoutCounter', (object) => {
      const reservations = object.data?._scriptedServiceQueueStore?.reservations || [];
      const queueBReleased = !reservations.some(entry => entry.agentId === 'queue-b');
      return queueBReleased && (
        reservations.some(entry => entry.agentId === 'queue-c' && entry.queueIndex === 0) ||
        object.agentId === 'queue-c'
      );
    });
    const queueCPromoted = await waitForAgent(scriptedRoom, 'queue-c', (agent) =>
      agent.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER &&
      agent.targetJson.includes('office:furniture:4:checkoutCounter') &&
      agent.targetJson.includes('"isQueueUse":false') &&
      agent.visualStateJson.includes('checkout-counter-customer')
    );
    assert(['routing', 'using'].includes(queueCPromoted.state));

    scriptedRoom.send('runtime:objectUseRequest', {
      requestId: 'adam-transformed-facing-object-use',
      agentId: 'adam',
      source: 'smoke-transformed-action-location-facing',
      target: {
        buildingId: 'office',
        furnitureIndex: 3,
        objectType: 'waterCooler',
        spotId: 'use-front',
      },
      agentPosition: { x: 40, y: 40, floor: 1 },
    });
    const transformedFacingAck = await waitForRoomMessage(scriptedRoom, 'runtime:ack', (msg) => msg.requestId === 'adam-transformed-facing-object-use');
    assert.equal(transformedFacingAck.type, 'runtime:objectUseRequest');
    assert.equal(transformedFacingAck.object.objectKey, 'office:furniture:3:waterCooler');
    assertRadiansClose(transformedFacingAck.snapshot.target?.faceAngle, -Math.PI / 2, 'server object-use fallback should face the furniture center like browser-owned 8590');
    await scriptedRoom.leave(true);

    console.log('realtime smoke ok');
  } finally {
    await stopServer(server);
  }
}

await run();
