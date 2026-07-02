#!/usr/bin/env node
// Targeted unit test (M1.4, 8590 parity): work-presence agents without a
// free desk must not freeze or double up on occupied desks. The plan claims
// desks distinctly; surplus working agents land in desklessWorkingAgentIds
// and the deskless wander keeps them moving until a desk frees.
import assert from 'node:assert/strict';
import { pickLiveStatusWorkTarget } from '../src/realtime/agent-runtime-room.mjs';

const targets = [
  {
    assignedTo: '',
    buildingId: 'bld-office',
    buildingType: 'office',
    buildingName: 'HQ Office',
    furnitureIndex: 1,
    target: { x: 100, y: 100, buildingId: 'bld-office', furnitureIndex: 1, objectType: 'desk', spotId: 'seat' },
  },
  {
    assignedTo: '',
    buildingId: 'bld-office',
    buildingType: 'office',
    buildingName: 'HQ Office',
    furnitureIndex: 2,
    target: { x: 120, y: 100, buildingId: 'bld-office', furnitureIndex: 2, objectType: 'desk', spotId: 'seat' },
  },
];
const workingAgentIds = ['agent-a', 'agent-b', 'agent-c'];
const meta = {};

// Distinct claiming: three working agents, two desks.
const claimed = new Set();
const picks = workingAgentIds.map(agentId =>
  pickLiveStatusWorkTarget(agentId, { meta, targets, workingAgentIds, claimedTargetIndexes: claimed })
);

const assignedPicks = picks.filter(Boolean);
assert.equal(assignedPicks.length, 2, 'exactly as many desk assignments as desks');
const desks = new Set(assignedPicks.map(t => t.furnitureIndex));
assert.equal(desks.size, 2, 'no two agents share one desk');
assert.equal(picks[2], null, 'surplus working agent gets no desk (deskless fallback)');

// When a desk frees (one agent stops working), the deskless agent claims it.
const claimed2 = new Set();
const secondRound = ['agent-a', 'agent-c'];
const picksAfter = secondRound.map(agentId =>
  pickLiveStatusWorkTarget(agentId, { meta, targets, workingAgentIds: secondRound, claimedTargetIndexes: claimed2 })
);
assert.ok(picksAfter[0] && picksAfter[1], 'freed desk is claimed by the previously deskless agent');
assert.notEqual(picksAfter[0].furnitureIndex, picksAfter[1].furnitureIndex, 'still no doubling');

// Legacy behavior without claiming stays intact (fallback to modulo sharing).
const legacy = pickLiveStatusWorkTarget('agent-c', { meta, targets, workingAgentIds });
assert.ok(legacy, 'legacy call without claimedTargetIndexes still returns a target');

console.log('verify-deskless-fallback: OK');
