#!/usr/bin/env node
// End-to-end smoke test for the Colyseus agent runtime sidecar.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';
import {
  AGENT_RUNTIME_ROOM_NAME,
  DEFAULT_WORLD_RUNTIME_TICK_MS,
  LIVE_ACTION_RUNTIME_POLL_MS,
  LIVE_STATUS_RUNTIME_POLL_MS,
  LIVE_STATUS_RUNTIME_OWNER,
  RUNTIME_STATE_BROADCAST_INTERVAL_MS,
  SERVER_SCRIPTED_OBJECT_RUNTIME_POLL_MS,
  SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER,
  SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER,
  SERVER_SCRIPTED_IDLE_INITIAL_DELAY_MS,
  SERVER_WORLD_TOPOLOGY_OWNER,
} from '../src/realtime/agent-runtime-room.mjs';

const root = process.cwd();

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

function waitForRoomMessage(room, type, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 5000);
    const unregister = room.onMessage(type, (message) => {
      if (!predicate(message)) return;
      clearTimeout(timeout);
      unregister();
      resolve(message);
    });
  });
}

async function waitForAgent(room, agentId, predicate = () => true) {
  const deadline = Date.now() + Math.max(5000, Number(SERVER_SCRIPTED_IDLE_INITIAL_DELAY_MS?.[1] || 0) + 8000);
  while (Date.now() < deadline) {
    const runtimeAgent = room.__runtimeDoc?.agents?.[agentId];
    const agent = runtimeAgent
      ? {
          ...runtimeAgent,
          targetJson: runtimeAgent.target ? JSON.stringify(runtimeAgent.target) : '',
          visualStateJson: runtimeAgent.visualState ? JSON.stringify(runtimeAgent.visualState) : '',
        }
      : room.state?.agents?.get?.(agentId);
    if (agent && predicate(agent)) return agent;
    await delay(50);
  }
  throw new Error(`timed out waiting for agent ${agentId}`);
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

async function waitForWorldRuntime(room, predicate = () => true) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const worldRuntime = testWorldRuntimeFromDocument(room.__runtimeDoc) || room.state?.worldRuntime;
    if (worldRuntime && predicate(worldRuntime)) return worldRuntime;
    await delay(50);
  }
  throw new Error('timed out waiting for worldRuntime');
}

async function waitForObject(room, objectKey, predicate = () => true) {
  const deadline = Date.now() + Math.max(6000, Number(SERVER_SCRIPTED_IDLE_INITIAL_DELAY_MS?.[1] || 0) + 8000);
  while (Date.now() < deadline) {
    const runtimeObject = room.__runtimeDoc?.objects?.[objectKey];
    const object = runtimeObject
      ? {
          ...runtimeObject,
          dataJson: runtimeObject.data ? JSON.stringify(runtimeObject.data) : '',
        }
      : room.state?.objects?.get?.(objectKey);
    if (object && predicate(object)) return object;
    await delay(50);
  }
  throw new Error(`timed out waiting for object ${objectKey}`);
}

async function connectRoom(port) {
  const client = new Client(`ws://127.0.0.1:${port}`);
  const room = await client.joinOrCreate(AGENT_RUNTIME_ROOM_NAME, { worldId: 'smoke' });
  room.onMessage('runtime:event', () => {});
  room.onMessage('runtime:state', (message) => {
    if (message?.snapshot) room.__runtimeDoc = message.snapshot;
  });
  room.onMessage('runtime:worldRuntime', (message) => {
    if (message?.worldRuntime && room.__runtimeDoc) {
      room.__runtimeDoc = { ...room.__runtimeDoc, worldRuntime: message.worldRuntime };
    }
  });
  const welcome = await waitForRoomMessage(room, 'runtime:welcome');
  if (welcome?.snapshot) room.__runtimeDoc = welcome.snapshot;
  return room;
}

async function run() {
  const dataDir = mkdtempSync(join(tmpdir(), 'vw-realtime-'));
  const port = await getOpenPort();
  let server = startServer({ port, dataDir });
  try {
    assert.equal(LIVE_ACTION_RUNTIME_POLL_MS, DEFAULT_WORLD_RUNTIME_TICK_MS, 'live action runtime should move at the world tick for smooth observer interpolation');
    assert.equal(LIVE_STATUS_RUNTIME_POLL_MS, DEFAULT_WORLD_RUNTIME_TICK_MS, 'live status runtime should move at the world tick for smooth observer interpolation');
    assert.equal(SERVER_SCRIPTED_OBJECT_RUNTIME_POLL_MS, DEFAULT_WORLD_RUNTIME_TICK_MS, 'scripted object runtime should move at the world tick for smooth observer interpolation');
    assert.equal(RUNTIME_STATE_BROADCAST_INTERVAL_MS, DEFAULT_WORLD_RUNTIME_TICK_MS, 'full runtime state broadcasts should not lag behind server movement ticks');

    const health = await waitForHealth(port, server);
    assert.equal(health.ok, true);
    assert.equal(health.room, AGENT_RUNTIME_ROOM_NAME);
    await verifyCorsPreflight(port);

    const room = await connectRoom(port);
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
    await room.leave(true);

    await stopServer(server);
    server = startServer({ port, dataDir });
    await waitForHealth(port, server);
    const resumedRoom = await connectRoom(port);
    const resumedAgent = await waitForAgent(resumedRoom, 'adam', (agent) => agent.x === 7.5 && agent.y === 8.25);
    assert.equal(resumedAgent.state, 'idle');
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
        adam: { agentLiveModeEnabled: true },
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
      adam: { state: 'idle', agentLiveModeEnabled: true },
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
        ],
      },
    }, null, 2)}\n`);

    const scriptedRoom = await connectRoom(port);
    const serverRuntime = await waitForWorldRuntime(scriptedRoom, (runtime) =>
      runtime.topologyOwner === SERVER_WORLD_TOPOLOGY_OWNER && runtime.trafficLights?.size >= 1
    );
    assert.equal(serverRuntime.topologyOwner, SERVER_WORLD_TOPOLOGY_OWNER);
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
    assert(Math.abs(Number(scriptedAgent.heading || 0)) <= Math.PI, 'server scripted runtime heading should be radians');
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
    assert(Math.abs(Number(workAgent.heading || 0)) <= Math.PI, 'work runtime heading should be radians');
    const workTarget = JSON.parse(workAgent.targetJson || '{}');
    assertRadiansClose(workTarget.faceAngle, Math.PI, 'authored desk faceAngle should be preserved');
    const workObject = await waitForObject(scriptedRoom, 'office:furniture:1:desk', (object) => object.owner === LIVE_STATUS_RUNTIME_OWNER);
    assert.equal(workObject.agentId, 'coder');
    assert(['routing', 'active'].includes(workObject.state));

    const meetingAgent = await waitForAgent(scriptedRoom, 'morgan', (agent) => agent.owner === LIVE_STATUS_RUNTIME_OWNER);
    assert(['routing', 'meeting'].includes(meetingAgent.state));
    assert(meetingAgent.visualStateJson.includes('live-status-meeting-table'));
    assert(Math.abs(Number(meetingAgent.heading || 0)) <= Math.PI, 'meeting runtime heading should be radians');
    const meetingTarget = JSON.parse(meetingAgent.targetJson || '{}');
    assertRadiansClose(meetingTarget.faceAngle, -Math.PI / 2, 'authored meeting faceAngle should be preserved');
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
    assert(bethWaterDeskTarget.objectKey.endsWith(':consume:beth'), 'desk consume should use a transient per-agent object key');
    await waitForObject(scriptedRoom, 'manual-building:furniture:2:waterCooler', (object) =>
      object.state === 'idle' &&
      object.dataJson.includes('temporary-water-picked-up')
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
    assert(coraVendingDeskTarget.objectKey.endsWith(':consume:cora'), 'vending desk consume should use a transient per-agent object key');
    await waitForObject(scriptedRoom, 'manual-building:furniture:5:vending', (object) =>
      object.state === 'idle' &&
      object.dataJson.includes('temporary-vending-item-picked-up')
    );
    const coraVendingDone = await waitForAgent(scriptedRoom, 'cora', (agent) =>
      agent.state === 'idle' &&
      agent.routeId === '' &&
      agent.visualStateJson.includes('"carrying":false') &&
      !agent.visualStateJson.includes('vendingItemId')
    );
    assert.equal(coraVendingDone.owner, 'agent-scripted-mode');

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
