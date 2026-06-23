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
    });
    const snapshotAck = await waitForRoomMessage(room, 'runtime:ack', (msg) => msg.requestId === 'snapshot-1');
    assert.equal(snapshotAck.snapshot.agentId, 'adam');
    assert.equal(snapshotAck.snapshot.x, 3.5);
    await waitForAgent(room, 'adam', (agent) => agent.x === 3.5 && agent.y === 4.25);

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

    room.send('runtime:heartbeat', {
      requestId: 'heartbeat-1',
      agentId: 'adam',
      leaseOwner: 'smoke-client-a',
      x: 7.5,
      y: 8.25,
      floor: 1,
      state: 'routing',
      ttlMs: 10000,
    });
    const heartbeatAck = await waitForRoomMessage(room, 'runtime:ack', (msg) => msg.requestId === 'heartbeat-1');
    assert.equal(heartbeatAck.snapshot.x, 7.5);
    await waitForAgent(room, 'adam', (agent) => agent.x === 7.5 && agent.state === 'routing');

    room.send('runtime:releaseRoute', {
      requestId: 'release-1',
      agentId: 'adam',
      leaseOwner: 'smoke-client-a',
      state: 'idle',
      reason: 'smoke-complete',
    });
    const releaseAck = await waitForRoomMessage(room, 'runtime:ack', (msg) => msg.requestId === 'release-1');
    assert.equal(releaseAck.snapshot.leaseOwner, '');
    assert.equal(releaseAck.snapshot.routeId, '');
    assert.equal(releaseAck.snapshot.worldActionId, '');
    await room.leave(true);

    await stopServer(server);
    server = startServer({ port, dataDir });
    await waitForHealth(port, server);
    const resumedRoom = await connectRoom(port);
    const resumedAgent = await waitForAgent(resumedRoom, 'adam', (agent) => agent.x === 7.5 && agent.y === 8.25);
    assert.equal(resumedAgent.state, 'idle');
    await resumedRoom.leave(true);

    console.log('realtime smoke ok');
  } finally {
    await stopServer(server);
  }
}

await run();
