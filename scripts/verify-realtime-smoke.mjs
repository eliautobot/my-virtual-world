#!/usr/bin/env node
// End-to-end smoke test for the Colyseus agent runtime sidecar.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';
import { AGENT_RUNTIME_ROOM_NAME } from '../src/realtime/agent-runtime-room.mjs';

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
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const agent = room.state?.agents?.get?.(agentId);
    if (agent && predicate(agent)) return agent;
    await delay(50);
  }
  throw new Error(`timed out waiting for agent ${agentId}`);
}

async function waitForWorldRuntime(room, predicate = () => true) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const worldRuntime = room.state?.worldRuntime;
    if (worldRuntime && predicate(worldRuntime)) return worldRuntime;
    await delay(50);
  }
  throw new Error('timed out waiting for worldRuntime');
}

async function connectRoom(port) {
  const client = new Client(`ws://127.0.0.1:${port}`);
  const room = await client.joinOrCreate(AGENT_RUNTIME_ROOM_NAME, { worldId: 'smoke' });
  room.onMessage('runtime:event', () => {});
  await waitForRoomMessage(room, 'runtime:welcome');
  return room;
}

async function run() {
  const dataDir = mkdtempSync(join(tmpdir(), 'vw-realtime-'));
  const port = await getOpenPort();
  let server = startServer({ port, dataDir });
  try {
    const health = await waitForHealth(port, server);
    assert.equal(health.ok, true);
    assert.equal(health.room, AGENT_RUNTIME_ROOM_NAME);

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
    });
    const topologyAck = await waitForRoomMessage(room, 'runtime:ack', (msg) => msg.requestId === 'world-topology-1');
    assert.equal(topologyAck.worldRuntime.schemaVersion, 'world-runtime/v1');
    assert.equal(Object.keys(topologyAck.worldRuntime.trafficLights).length, 2);
    assert.equal(topologyAck.worldRuntime.topologyHash, 'traffic:smoke');
    const firstWorldRuntime = await waitForWorldRuntime(room, (runtime) => runtime.trafficLights?.size === 2);
    const firstPhase = firstWorldRuntime.trafficLights.get('traffic:0,0').phaseMs;
    const firstTickSeq = firstWorldRuntime.tickSeq;
    const firstSimTimeMs = firstWorldRuntime.simTimeMs;
    const tickedWorldRuntime = await waitForWorldRuntime(room, (runtime) => runtime.tickSeq > firstTickSeq && runtime.trafficLights.get('traffic:0,0').phaseMs !== firstPhase);
    assert(tickedWorldRuntime.simTimeMs > firstSimTimeMs);

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
    await resumedRoom.leave(true);

    console.log('realtime smoke ok');
  } finally {
    await stopServer(server);
  }
}

await run();
