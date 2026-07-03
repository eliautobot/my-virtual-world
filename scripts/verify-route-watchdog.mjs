#!/usr/bin/env node
// Targeted unit test: scripted-object route watchdog aborts routings stuck
// longer than SERVER_RUNTIME_ROUTE_STALE_AFTER_MS (M1.1, 8590 parity).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentRuntimeRoom,
  SERVER_RUNTIME_ROUTE_STALE_AFTER_MS,
  SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER,
  SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER,
} from '../src/realtime/agent-runtime-room.mjs';

assert.equal(SERVER_RUNTIME_ROUTE_STALE_AFTER_MS, 45000, 'stale window mirrors 8590 AGENT_INTENT_APPROACH_STALE_AFTER_MS');

function makeRoom({ nowMs, routeStartedAt }) {
  const room = Object.create(AgentRuntimeRoom.prototype);
  room.dataDir = mkdtempSync(join(tmpdir(), 'vw-watchdog-'));
  room.lastScriptedObjectRuntimeStepMs = 0;
  room.scriptedObjectRuntimeCooldowns = new Map();
  room.scriptedObjectRuntimeMemory = new Map();
  room.scriptedObjectRuntimeNextPulseAtMs = new Map();
  room.scriptedObjectRuntimeIdleCursor = 0;
  const target = {
    x: 59680, // unreachable far-away target
    y: -41440,
    floor: 1,
    buildingId: 'bld-test',
    roomId: '',
    targetKind: 'scripted-object',
    objectKey: 'object:bld-test:3:armchair',
    baseObjectKey: 'object:bld-test:3:armchair',
    furnitureIndex: 3,
    objectType: 'armchair',
    spotId: 'sit',
    slotId: 'sit',
    isQueueUse: false,
    runtimeSource: 'idle',
    runtimeStartedAt: new Date(routeStartedAt).toISOString(),
    routeStartedAt: new Date(routeStartedAt).toISOString(),
    runtimeActiveAt: '',
    stayMs: 7000,
  };
  room.state = {
    agents: new Map([
      ['permi', {
        agentId: 'permi',
        mode: 'live',
        owner: SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER,
        x: 500,
        y: -28,
        floor: 1,
        buildingId: 'bld-test',
        roomId: '',
        heading: 0,
        state: 'routing',
        routeId: 'scripted-object:permi:bld-test:3:sit',
        worldActionId: '',
        leaseOwner: SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER,
        leaseExpiresAt: new Date(nowMs + 15000).toISOString(),
        updatedAt: new Date(nowMs).toISOString(),
        version: 1,
        targetJson: JSON.stringify(target),
        visualStateJson: '',
      }],
    ]),
    objects: new Map(),
  };
  room.loadScriptedObjectRuntimePlan = () => ({ idleAgentIds: ['permi'], targets: [] });
  room.calls = { released: [], failures: [], snapshots: [] };
  room.releaseServerScriptedObjectRoute = (agentId, current, tgt, ms, iso, reason) => {
    room.calls.released.push({ agentId, reason, x: tgt?.x, y: tgt?.y });
    return { agent: null, object: null };
  };
  room.markServerScriptedRuntimeFailure = (agentId, tgt, reason) => {
    room.calls.failures.push({ agentId, reason });
  };
  room.upsertSnapshot = (raw, eventType) => {
    room.calls.snapshots.push({ eventType, state: raw.state });
    return { agent: raw, changed: true };
  };
  room.upsertWorldObject = () => ({ object: null, changed: true });
  room.ensureServerScriptedIdlePulseDue = () => false;
  return room;
}

// Case 1: routing older than the stale window -> aborted with route-stale + cooldown.
{
  const nowMs = Date.now();
  const room = makeRoom({ nowMs, routeStartedAt: nowMs - SERVER_RUNTIME_ROUTE_STALE_AFTER_MS - 5000 });
  room.tickScriptedObjectRuntime(200, nowMs);
  assert.equal(room.calls.released.length, 1, 'stale routing must be released');
  assert.equal(room.calls.released[0].reason, 'route-stale');
  assert.equal(room.calls.released[0].agentId, 'permi');
  assert.equal(room.calls.failures[0]?.reason, 'route-stale', 'failure memory recorded');
  const cooldownUntil = Number(room.scriptedObjectRuntimeCooldowns.get('permi') || 0);
  assert.ok(cooldownUntil > nowMs, 'agent gets a re-pick cooldown');
}

// Case 2: routing within the stale window -> not aborted.
{
  const nowMs = Date.now();
  const room = makeRoom({ nowMs, routeStartedAt: nowMs - 10000 });
  room.tickScriptedObjectRuntime(200, nowMs);
  assert.equal(room.calls.released.length, 0, 'fresh routing must not be released');
  assert.equal(room.scriptedObjectRuntimeCooldowns.size, 0);
}

console.log('verify-route-watchdog: OK');
