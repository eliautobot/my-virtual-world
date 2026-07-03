#!/usr/bin/env node
// Targeted unit test (M3.1, 8590 parity): idle agents within proximity start
// a server-owned conversation (forced random), face each other with
// gather-talk visual state and role swaps, then end with post cooldowns.
import assert from 'node:assert/strict';
import {
  AgentRuntimeRoom,
  SERVER_SOCIAL_RUNTIME_OWNER,
  SERVER_SOCIAL_RUNTIME_LEASE_OWNER,
  SERVER_SOCIAL_CONVERSATION_DURATION_MS,
} from '../src/realtime/agent-runtime-room.mjs';

function makeAgent(agentId, x, y) {
  return {
    agentId,
    mode: 'scripted',
    owner: 'agent-scripted-mode',
    x,
    y,
    floor: 1,
    buildingId: '',
    roomId: '',
    heading: 0,
    state: 'idle',
    routeId: '',
    worldActionId: '',
    leaseOwner: '',
    leaseExpiresAt: '',
    target: null,
    visualState: null,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}

function makeRoom(nowMs) {
  const room = Object.create(AgentRuntimeRoom.prototype);
  room.socialConversations = new Map();
  room.socialCooldowns = new Map();
  room.socialEvalCursor = 0;
  room.socialRandom = () => 0; // always below chance threshold; min-range durations
  const agents = new Map([
    ['alice', makeAgent('alice', 500, -20)],
    ['bob', makeAgent('bob', 540, -20)],
  ]);
  room.state = { agents, objects: new Map(), updatedAt: new Date(nowMs).toISOString() };
  const written = [];
  room.upsertSnapshot = (raw, eventType, extra = {}) => {
    const existing = room.state.agents.get(raw.agentId) || {};
    const next = { ...existing, ...raw, version: Number(existing.version || 0) + 1 };
    room.state.agents.set(raw.agentId, next);
    written.push({ eventType, raw, extra });
    return { agent: next, event: { type: eventType } };
  };
  room.written = written;
  return room;
}

const t0 = Date.now();
const room = makeRoom(t0);
const idle = new Set(['alice', 'bob']);

// Tick 1: conversation should start (forced roll of 0 < 0.22).
room.tickSocialConversations(idle, 250, t0, new Date(t0).toISOString());
assert.equal(room.socialConversations.size, 1, 'conversation started');
const convo = [...room.socialConversations.values()][0];
assert.deepEqual([...convo.participants].sort(), ['alice', 'bob'], 'both agents participate');

const alice = room.state.agents.get('alice');
const bob = room.state.agents.get('bob');
assert.equal(alice.owner, SERVER_SOCIAL_RUNTIME_OWNER, 'alice owned by social runtime');
assert.equal(bob.leaseOwner, SERVER_SOCIAL_RUNTIME_LEASE_OWNER, 'bob leased by social runtime');
assert.equal(alice.state, 'social', 'social state set');
assert.equal(alice.visualState.resolvedAnimationId, 'gather-talk', 'gather-talk animation');
const roles = [alice.visualState.activity.role, bob.visualState.activity.role].sort();
assert.deepEqual(roles, ['listening', 'talking'], 'one talker one listener');
// Facing each other: alice is left of bob -> alice faces +x (0 rad), bob faces -x (pi).
assert.ok(Math.abs(alice.heading) < 0.01, 'alice faces bob');
assert.ok(Math.abs(Math.abs(bob.heading) - Math.PI) < 0.01, 'bob faces alice');

// Role switch after switch timer.
const speakerBefore = convo.speakerIndex;
room.tickSocialConversations(idle, 250, convo.nextRoleSwitchAtMs + 1, new Date().toISOString());
assert.notEqual(convo.speakerIndex, speakerBefore, 'speaker role swapped');

// End after duration: agents released to idle with cooldowns.
const tEnd = t0 + SERVER_SOCIAL_CONVERSATION_DURATION_MS[0] + 1;
room.tickSocialConversations(idle, 250, tEnd, new Date(tEnd).toISOString());
assert.equal(room.socialConversations.size, 0, 'conversation ended');
const aliceAfter = room.state.agents.get('alice');
assert.equal(aliceAfter.state, 'idle', 'agent returned to idle');
assert.equal(aliceAfter.owner, 'agent-scripted-mode', 'ownership released');
assert.ok(Number(room.socialCooldowns.get('alice')) > tEnd, 'post-conversation cooldown set');
assert.ok(Number(room.socialCooldowns.get('bob')) > tEnd, 'post-conversation cooldown set (bob)');

// Cooldown blocks immediate restart.
room.tickSocialConversations(idle, 250, tEnd + 1000, new Date(tEnd + 1000).toISOString());
assert.equal(room.socialConversations.size, 0, 'cooldown prevents immediate new conversation');

console.log('verify-social-conversations: OK');
