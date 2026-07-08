#!/usr/bin/env node
// Verify behavior-layer separation:
//   Layer 1 (scripted live-status desk runtime, scripted object runtime,
//   deskless wander) must never claim an agent that has Agent Live Mode
//   enabled (Layer 2), even when gateway presence reports "working" during
//   model inference. Ambient participation is only allowed with an explicit
//   scriptedAmbientEnabled === true opt-in.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildLiveStatusRuntimePlan,
  buildScriptedObjectRuntimePlan,
} from '../src/realtime/agent-runtime-room.mjs';

const failures = [];
function check(name, cond, detail = '') {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures.push(name);
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vw-layer-separation-'));
fs.mkdirSync(path.join(dataDir, 'buildings'), { recursive: true });

// World meta: liveAgent has Live Mode on (Ambient off), ambientLiveAgent has
// Live Mode on AND explicit ambient opt-in, scriptedAgent is a normal agent.
fs.writeFileSync(path.join(dataDir, 'world-meta.json'), JSON.stringify({
  name: 'Layer Separation Test World',
  agentProfiles: {
    liveAgent: { agentLiveModeEnabled: true, scriptedAmbientEnabled: false, ambientEnabled: false },
    ambientLiveAgent: { agentLiveModeEnabled: true, scriptedAmbientEnabled: true, ambientEnabled: true },
    scriptedAgent: {},
  },
  agentAssignments: {},
}));

// Presence: everyone "working" (as happens during model inference for live
// agents), plus idle records for the scripted-object runtime plan.
fs.writeFileSync(path.join(dataDir, 'presence-snapshot.json'), JSON.stringify({
  liveAgent: { state: 'working', task: 'model inference' },
  ambientLiveAgent: { state: 'idle', task: '' },
  scriptedAgent: { state: 'working', task: 'office work' },
  idleScriptedAgent: { state: 'idle', task: '' },
  _meetings: [
    { id: 'm1', participants: ['liveAgent', 'scriptedAgent'] },
  ],
}));

// One office building with desks so the desk planner has real targets.
fs.writeFileSync(path.join(dataDir, 'buildings', 'office-1.json'), JSON.stringify({
  id: 'office-1',
  name: 'Test Office',
  type: 'office',
  worldX: 0,
  worldY: 0,
  widthTiles: 12,
  heightTiles: 10,
  interior: {
    furniture: [
      { id: 'desk-1', type: 'desk', x: 2, z: 2, floor: 1 },
      { id: 'desk-2', type: 'desk', x: 5, z: 2, floor: 1 },
      { id: 'desk-3', type: 'desk', x: 8, z: 2, floor: 1 },
      { id: 'meeting-1', type: 'meetingTable', x: 5, z: 6, floor: 1 },
    ],
  },
}));

const plan = buildLiveStatusRuntimePlan(dataDir);

check(
  'live-mode agent excluded from desk-work plan despite presence=working',
  !plan.workingAgentIds.includes('liveAgent'),
  JSON.stringify(plan.workingAgentIds),
);
check(
  'live-mode agent has no desk target',
  !plan.targetsByAgent.liveAgent,
  JSON.stringify(Object.keys(plan.targetsByAgent)),
);
check(
  'live-mode agent not in deskless wander fallback',
  !(plan.desklessWorkingAgentIds || []).includes('liveAgent'),
  JSON.stringify(plan.desklessWorkingAgentIds),
);
check(
  'live-mode agent excluded from scripted meeting seating',
  !(plan.meetingAgentIds || []).includes('liveAgent'),
  JSON.stringify(plan.meetingAgentIds),
);
check(
  'normal scripted agent still desk-routed',
  plan.workingAgentIds.includes('scriptedAgent') || (plan.meetingAgentIds || []).includes('scriptedAgent'),
  JSON.stringify({ working: plan.workingAgentIds, meeting: plan.meetingAgentIds }),
);

const scriptedPlan = buildScriptedObjectRuntimePlan(dataDir);
check(
  'live-mode agent without ambient opt-in excluded from scripted idle objects',
  !scriptedPlan.idleAgentIds.includes('liveAgent'),
  JSON.stringify(scriptedPlan.idleAgentIds),
);
check(
  'live-mode agent WITH ambient opt-in still allowed in scripted idle objects',
  scriptedPlan.idleAgentIds.includes('ambientLiveAgent'),
  JSON.stringify(scriptedPlan.idleAgentIds),
);
check(
  'normal idle agent still in scripted idle objects',
  scriptedPlan.idleAgentIds.includes('idleScriptedAgent'),
  JSON.stringify(scriptedPlan.idleAgentIds),
);

fs.rmSync(dataDir, { recursive: true, force: true });

console.log('');
if (failures.length) {
  console.log(`FAILED: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('verify-live-mode-layer-separation: ALL PASS');
