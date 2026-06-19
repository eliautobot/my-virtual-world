#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

const TEST_PORT = 8587;
const PRODUCT_PORT = 8590;
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${TEST_PORT}`;
const PRODUCT_URL = `http://${HOST}:${PRODUCT_PORT}`;
const TEST_AGENT_ID = 'acceptance-agent';
const PEER_AGENT_ID = 'acceptance-peer';
const OFFICE_BUILDING_ID = 'acceptance-office';
const HOME_BUILDING_ID = 'acceptance-home';
const WATER_COOLER_ID = 'acceptance-water-cooler';
const COFFEE_MACHINE_ID = 'acceptance-coffee-machine';
const VENDING_ID = 'acceptance-vending';
const WHITEBOARD_ID = 'acceptance-whiteboard';
const PRINTER_ID = 'acceptance-printer';
const MICROWAVE_ID = 'acceptance-microwave';
const ACCEPTANCE_TURN_TARGET = Math.max(1, Number.parseInt(process.env.VW_LIVE_AGENT_MODE_ACCEPTANCE_TURNS || '12', 10) || 12);
const keepOpen = process.argv.includes('--keep-open');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Usage:
  npm run verify:live-agent-mode:8587
  npm run dev:live-agent-mode:8587

The harness starts My Virtual World on ${BASE_URL} with temporary data,
checks /healthz, proves a backend Live Agent Mode turn can finish without
a browser, runs autonomy metrics, runs a browser replay/render check against emitted animation
events, pins the child process to ${TEST_PORT}, and refuses environment or
argument targets that point at ${PRODUCT_URL}.`);
  process.exit(0);
}

const targetEnvKeys = [
  'VW_PORT',
  'VW_HOST_PORT',
  'VW_PUBLIC_ORIGIN',
  'VW_TEST_BASE_URL',
  'BASE_URL',
  'TARGET_BASE_URL',
  'PLAYWRIGHT_BASE_URL',
];

function valueMentionsPort(value, port) {
  if (!value) return false;
  const text = String(value).trim();
  return text === String(port) || text.includes(`:${port}`);
}

function assertNoProductPortTargets() {
  for (const key of targetEnvKeys) {
    const value = process.env[key];
    if (valueMentionsPort(value, PRODUCT_PORT)) {
      throw new Error(`${key} targets product port ${PRODUCT_PORT}; use ${TEST_PORT} or unset it for this harness.`);
    }
  }
  for (const arg of process.argv.slice(2)) {
    if (valueMentionsPort(arg, PRODUCT_PORT)) {
      throw new Error(`argument targets product port ${PRODUCT_PORT}: ${arg}`);
    }
  }
}

function assertNoConflictingHarnessPortEnv() {
  for (const key of ['VW_PORT', 'VW_HOST_PORT']) {
    const value = process.env[key];
    if (value && String(value).trim() !== String(TEST_PORT)) {
      throw new Error(`${key} is set to ${value}; this harness is pinned to ${TEST_PORT}.`);
    }
  }
}

function isTcpOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port, timeout: 500 });
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function assertPortAvailable(port) {
  if (await isTcpOpen(port)) {
    throw new Error(`port ${port} is unavailable: an existing listener answered on ${HOST}:${port}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message, details = undefined) {
  if (condition) return;
  const suffix = details === undefined ? '' : `\n${typeof details === 'string' ? details : JSON.stringify(details, null, 2)}`;
  throw new Error(`${message}${suffix}`);
}

async function requestJson(path, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      throw new Error(`${path} returned HTTP ${response.status}${payload ? `\n${JSON.stringify(payload, null, 2)}` : ''}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(path) {
  return requestJson(path);
}

async function postJson(path, body) {
  return requestJson(path, { method: 'POST', body });
}

async function waitForHealth(child, getOutput) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null || child.signalCode) {
      throw new Error(`server exited before health check passed\n${getOutput()}`);
    }
    try {
      const health = await fetchJson('/healthz');
      if (health && health.ok === true && Number(health.port) === TEST_PORT) {
        return health;
      }
    } catch {
      // Keep waiting until startup completes or the child exits.
    }
    await delay(250);
  }
  throw new Error(`timed out waiting for ${BASE_URL}/healthz\n${getOutput()}`);
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(2500).then(() => {
      if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
    }),
  ]);
}

function writeAcceptanceWorkspace(workspaceRoot) {
  const agentDir = join(workspaceRoot, 'agents', TEST_AGENT_ID, 'agent');
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'IDENTITY.md'), [
    '# Acceptance Agent',
    '',
    '- **Name:** Acceptance Agent',
    '- **Emoji:** A',
    '- **Role:** Isolated Live Agent Mode acceptance fixture',
    '',
  ].join('\n'));
  const peerDir = join(workspaceRoot, 'agents', PEER_AGENT_ID, 'agent');
  mkdirSync(peerDir, { recursive: true });
  writeFileSync(join(peerDir, 'IDENTITY.md'), [
    '# Acceptance Peer',
    '',
    '- **Name:** Acceptance Peer',
    '- **Emoji:** P',
    '- **Role:** Isolated Live Agent Mode social fixture',
    '',
  ].join('\n'));
}

function acceptanceOfficeBuilding() {
  return {
    id: OFFICE_BUILDING_ID,
    name: '8587 Acceptance Office',
    type: 'office',
    worldX: 12,
    worldY: 8,
    x: 12,
    z: 8,
    widthTiles: 12,
    heightTiles: 10,
    width: 12,
    depth: 10,
    interior: {
      furniture: [
        {
          id: WATER_COOLER_ID,
          objectInstanceId: WATER_COOLER_ID,
          type: 'waterCooler',
          catalogId: 'waterCooler',
          x: 5,
          z: 4,
          floor: 1,
          buildingFloor: 1,
          capabilityTags: ['life.hydration'],
        },
        {
          id: COFFEE_MACHINE_ID,
          objectInstanceId: COFFEE_MACHINE_ID,
          type: 'countertopCoffeeMachine',
          catalogId: 'countertopCoffeeMachine',
          x: 7,
          z: 4,
          floor: 1,
          buildingFloor: 1,
          capabilityTags: ['life.hydration'],
        },
        {
          id: VENDING_ID,
          objectInstanceId: VENDING_ID,
          type: 'vending',
          catalogId: 'vending',
          x: 8,
          z: 6,
          floor: 1,
          buildingFloor: 1,
          capabilityTags: ['life.food'],
        },
        {
          id: WHITEBOARD_ID,
          objectInstanceId: WHITEBOARD_ID,
          type: 'whiteboard',
          catalogId: 'whiteboard',
          x: 3,
          z: 2,
          floor: 1,
          buildingFloor: 1,
          capabilityTags: ['planning.brainstorm'],
        },
        {
          id: PRINTER_ID,
          objectInstanceId: PRINTER_ID,
          type: 'printerCopier',
          catalogId: 'printerCopier',
          x: 3,
          z: 7,
          floor: 1,
          buildingFloor: 1,
          capabilityTags: ['maintenance.printCopy'],
        },
        {
          id: MICROWAVE_ID,
          objectInstanceId: MICROWAVE_ID,
          type: 'microwave',
          catalogId: 'microwave',
          x: 9,
          z: 3,
          floor: 1,
          buildingFloor: 1,
          capabilityTags: ['life.food'],
        },
      ],
    },
  };
}

function acceptanceHomeBuilding() {
  return {
    id: HOME_BUILDING_ID,
    name: '8587 Acceptance Home',
    type: 'home',
    worldX: -12,
    worldY: -10,
    x: -12,
    z: -10,
    widthTiles: 10,
    heightTiles: 8,
    width: 10,
    depth: 8,
    liveModeHomeForAgentId: TEST_AGENT_ID,
    ownerAgentId: TEST_AGENT_ID,
    interior: { furniture: [] },
  };
}

async function seedAcceptanceWorld() {
  const office = await postJson('/api/building', acceptanceOfficeBuilding());
  assert(office?.ok === true, 'failed to seed acceptance office building', office);

  const home = await postJson('/api/building', acceptanceHomeBuilding());
  assert(home?.ok === true, 'failed to seed acceptance home building', home);

  const now = new Date().toISOString();
  const seeded = await postJson('/api/meta', {
    initialized: true,
    name: '8587 Live Agent Mode Acceptance',
    agentAssignments: {
      [TEST_AGENT_ID]: {
        home: HOME_BUILDING_ID,
        work: OFFICE_BUILDING_ID,
      },
    },
    agentProfiles: {
      [TEST_AGENT_ID]: {
        name: 'Acceptance Agent',
        agentLiveModeEnabled: true,
        personality: {
          outgoing: 0.4,
          curious: 0.5,
          easygoing: 0.8,
        },
      },
      [PEER_AGENT_ID]: {
        name: 'Acceptance Peer',
        agentLiveModeEnabled: false,
        personality: {
          outgoing: 0.6,
          curious: 0.4,
          easygoing: 0.5,
        },
      },
    },
    agentLife: {
      simulation: {
        schemaVersion: 'agent-live-mode-simulation/v1',
        updatedAt: now,
        agentLocations: {
          [TEST_AGENT_ID]: {
            source: '8587-acceptance-seed',
            agentId: TEST_AGENT_ID,
            buildingId: HOME_BUILDING_ID,
            floor: 1,
            x: -7,
            z: -7,
            apiX: -280,
            apiZ: -280,
            updatedAt: now,
          },
          [PEER_AGENT_ID]: {
            source: '8587-acceptance-seed',
            agentId: PEER_AGENT_ID,
            buildingId: OFFICE_BUILDING_ID,
            floor: 1,
            x: 18,
            z: 12,
            apiX: 720,
            apiZ: 480,
            updatedAt: now,
          },
        },
      },
      liveModeLoop: {
        schemaVersion: 'agent-live-mode-loop/v1',
        enabled: true,
        worldClientRequired: false,
        minActionIntervalSec: 30,
        maxActionsPerTick: 1,
        agents: {
          [TEST_AGENT_ID]: {
            enabled: true,
            lastNeedUpdateAt: now,
            needs: {
              hydration: 0.95,
              food: 0.1,
              energy: 0.1,
              curiosity: 0.1,
              maintenance: 0.1,
              shelter: 0.1,
              social: 0.1,
            },
          },
        },
      },
    },
  });
  assert(seeded?.ok === true, 'failed to seed acceptance world metadata', seeded);

  const liveMode = await postJson(`/api/agent/${encodeURIComponent(TEST_AGENT_ID)}/live-mode`, {
    agentLiveModeEnabled: true,
  });
  assert(liveMode?.ok === true && liveMode.agentLiveModeEnabled === true, 'failed to enable Live Agent Mode for acceptance agent', liveMode);

  const loopSettings = await postJson('/api/agent-live-loop', {
    enabled: true,
    worldClientRequired: false,
    clearWorldClientActivity: true,
    clearPause: true,
    clearKillSwitch: true,
    maxActionsPerTick: 1,
    minActionIntervalSec: 30,
    agentId: TEST_AGENT_ID,
    agentEnabled: true,
    clearTurnRetry: true,
  });
  assert(loopSettings?.ok === true, 'failed to configure Live Agent Mode loop for acceptance', loopSettings);
}

async function enableGlobalAgentLiveModeFeature() {
  const settings = await postJson('/api/settings', {
    features: {
      agentLiveMode: true,
    },
  });
  assert(settings?.ok === true, 'failed to enable global Agent Live Mode feature for acceptance', settings);
  assert(settings?.config?.features?.agentLiveMode === true, 'global Agent Live Mode feature did not persist for acceptance', settings?.config?.features);
}

async function verifyNoBrowserBackendTurn(reason = '8587-acceptance-no-browser') {
  const before = await fetchJson('/api/agent-live-loop');
  assert(before?.runtime?.worldClient?.active === false, 'expected no active browser client before backend tick', before?.runtime?.worldClient);
  assert(before?.runtime?.guardrails?.browserTabRequiredForScheduler === false, 'expected scheduler guardrail to allow no-browser progression', before?.runtime?.guardrails);

  const tick = await postJson('/api/agent-live-loop/tick', {
    reason,
    force: true,
  });
  assert(tick?.ok === true, 'Live Agent Mode backend tick failed', tick);
  assert(tick?.worldClient?.active === false, 'backend tick unexpectedly depended on an active browser client', tick?.worldClient);
  assert(Array.isArray(tick.actionsCreated) && tick.actionsCreated.length >= 1, 'backend tick did not create an action', tick);
  assert(!Array.isArray(tick.errors) || tick.errors.length === 0, 'backend tick returned errors', tick.errors);

  const created = tick.actionsCreated[0];
  const actionId = created?.actionId;
  assert(actionId, 'backend tick action is missing an actionId', created);

  const active = await fetchJson('/api/world-actions/active');
  assert(Array.isArray(active), 'active world actions response was not a list', active);
  const stillActive = active.find((action) => action?.id === actionId);
  assert(!stillActive, 'backend-owned action was still active after no-browser tick', stillActive);

  const history = await fetchJson('/api/world-actions/history');
  assert(Array.isArray(history), 'history world actions response was not a list', history);
  const completed = history.find((action) => action?.id === actionId);
  assert(completed?.status === 'completed', 'backend-owned action did not complete', completed);
  assert(completed?.execution?.clientRequiredForProgress === false, 'completed action should record browser-free progress', completed?.execution);
  assert(completed?.route?.clientRequiredForProgress === false, 'completed action route should record browser-free progress', completed?.route);
  const routeTo = completed?.result?.backendExecution?.route?.to;
  if (routeTo?.coordinateSpace === 'world-tiles') {
    assert(Math.abs(Number(routeTo.x || 0)) < 500 && Math.abs(Number(routeTo.z || 0)) < 500, 'backend route location should be stored in world tiles, not API pixels', routeTo);
  }

  const replay = await fetchJson(`/api/live-agent-mode/animation-events?actionId=${encodeURIComponent(actionId)}&limit=20`);
  const names = new Set((replay?.events || []).map((event) => event?.name));
  for (const expected of ['agent-move-started', 'agent-arrived', 'object-use-started', 'object-use-completed', 'world-action-completed']) {
    assert(names.has(expected), `animation replay events missing ${expected}`, replay);
  }
  assert(replay?.replay?.clientRequiredForProgress === false, 'animation replay endpoint should not require a browser for progress', replay?.replay);

  console.log(`PASS: no-browser Live Agent Mode turn completed ${actionId} with ${replay.events.length} replay events.`);
  return { actionId, action: completed, events: replay.events };
}

async function verifyNoBrowserBackendTurnSeries(targetCount = ACCEPTANCE_TURN_TARGET) {
  const proofs = [];
  const actionTypes = new Set();
  for (let index = 0; index < targetCount; index += 1) {
    const proof = await verifyNoBrowserBackendTurn(`8587-acceptance-no-browser-${index + 1}`);
    proofs.push(proof);
    if (proof.action?.actionType) actionTypes.add(proof.action.actionType);
  }
  console.log(`PASS: ${proofs.length}/${targetCount} no-browser backend turns completed with action types: ${Array.from(actionTypes).sort().join(', ')}`);
  return { proofs, actionTypes: Array.from(actionTypes).sort() };
}

function liveAgentSource(requestId) {
  return {
    kind: 'agent-live-mode',
    requestId,
    surface: '8587-acceptance-harness',
    roles: ['participant'],
  };
}

async function requestLiveAgentAction({ actionType, capabilityTag, target, params = {}, agentId = TEST_AGENT_ID, requestId }) {
  const result = await postJson('/api/agent-model/actions', {
    agentId,
    source: liveAgentSource(requestId || `8587-acceptance-${actionType}`),
    actionType,
    capabilityTag,
    target,
    priority: 'normal',
    params: {
      reason: '8587-autonomy-metrics',
      ...params,
    },
  });
  assert(result?.ok === true, `Live Agent action request failed for ${actionType}`, result);
  const action = result.action || result.worldAction?.action;
  assert(action?.status === 'completed', `Live Agent action ${actionType} did not complete`, action || result);
  assert(action?.execution?.clientRequiredForProgress === false, `Live Agent action ${actionType} should be backend-owned`, action?.execution);
  return { result, action };
}

async function verifyTypedObjectActions() {
  const targets = [
    {
      actionType: 'life.getCoffee',
      capabilityTag: 'life.hydration',
      target: { kind: 'object-instance', buildingId: OFFICE_BUILDING_ID, objectInstanceId: COFFEE_MACHINE_ID, catalogId: 'countertopCoffeeMachine', interactionSpotId: 'use-front', floor: 1 },
    },
    {
      actionType: 'life.buyVendingSnackDrink',
      capabilityTag: 'life.food',
      target: { kind: 'object-instance', buildingId: OFFICE_BUILDING_ID, objectInstanceId: VENDING_ID, catalogId: 'vending', interactionSpotId: 'use-front', floor: 1 },
    },
    {
      actionType: 'planning.brainstorm',
      capabilityTag: 'planning.brainstorm',
      target: { kind: 'object-instance', buildingId: OFFICE_BUILDING_ID, objectInstanceId: WHITEBOARD_ID, catalogId: 'whiteboard', interactionSpotId: 'presenter', floor: 1 },
    },
  ];
  const actions = [];
  for (const target of targets) {
    const proof = await requestLiveAgentAction({
      ...target,
      requestId: `8587-acceptance-object-${target.actionType}`,
    });
    actions.push(proof.action);
  }
  console.log(`PASS: typed object backend actions completed: ${actions.map((action) => action.actionType).join(', ')}`);
  return actions;
}

async function executeLiveAgentTool(tool, args, { agentId = TEST_AGENT_ID, requestId, dryRun = false } = {}) {
  const result = await postJson('/api/live-agent-mode/tool-calls', {
    agentId,
    source: liveAgentSource(requestId || `8587-acceptance-tool-${tool}`),
    tool,
    arguments: args,
    dryRun,
  });
  assert(result?.ok === true, `Live Agent tool ${tool} failed`, result);
  return result;
}

async function verifySocialCommunicationAndMemory() {
  const social = await requestLiveAgentAction({
    actionType: 'life.social',
    capabilityTag: 'life.social',
    target: {
      kind: 'agent',
      targetAgentId: PEER_AGENT_ID,
      buildingId: OFFICE_BUILDING_ID,
      floor: 1,
    },
    requestId: '8587-acceptance-social-agent-target',
  });

  const speech = await executeLiveAgentTool('say_to_agent', {
    targetAgentId: PEER_AGENT_ID,
    message: 'Acceptance check: visible resident conversation and reaction opportunity.',
    tone: 'friendly',
  }, { requestId: '8587-acceptance-say-to-agent' });
  assert(speech.toolCall?.result?.reactionOpportunityCount >= 1, 'say_to_agent should create a reaction opportunity', speech);

  const memory = await executeLiveAgentTool('add_memory', {
    text: 'Acceptance harness confirmed backend-owned Live Agent Mode can communicate and remember.',
    importance: 'high',
    tags: ['acceptance', 'autonomy'],
  }, { requestId: '8587-acceptance-add-memory' });
  assert(memory.toolCall?.result?.memoryEntry?.id, 'add_memory should persist a memory entry', memory);
  assert(memory.toolCall?.result?.streamEntry?.id, 'add_memory should append to the memory stream', memory);
  assert(memory.toolCall?.result?.reflection?.id, 'add_memory should synthesize a reflection from accumulated stream entries', memory);

  const communications = await fetchJson(`/api/live-agent-mode/in-world-communications?agentId=${encodeURIComponent(TEST_AGENT_ID)}&limit=20`);
  assert((communications.events || []).some((event) => event.targetAgentId === PEER_AGENT_ID), 'communication log should include the peer-targeted event', communications);

  const retrieved = await fetchJson(`/api/live-agent-mode/memory/${encodeURIComponent(TEST_AGENT_ID)}?query=${encodeURIComponent('communicate remember acceptance')}&limit=5`);
  assert(retrieved?.ok === true, 'memory retrieval endpoint should return ok', retrieved);
  assert((retrieved.results || []).length >= 1, 'memory retrieval should return ranked results', retrieved);
  assert(typeof retrieved.results[0]?.retrieval?.score === 'number', 'memory retrieval should include deterministic scores', retrieved.results?.[0]);
  assert(retrieved.memory?.counts?.stream >= 2, 'memory stream should include conversation and memory entries', retrieved.memory?.counts);
  assert(retrieved.memory?.counts?.reflections > 0, 'memory endpoint should report synthesized reflections', retrieved.memory?.counts);

  console.log(`PASS: social target ${social.action.id}, in-world speech ${speech.toolCall.id}, memory ${memory.toolCall.result.memoryEntry.id}, and reflection ${memory.toolCall.result.reflection.id} verified.`);
  return { socialAction: social.action, speech, memory, communications, retrieved };
}

async function verifyOperatorControlsStopTurns() {
  const paused = await postJson('/api/agent-live-loop', {
    pauseSec: 120,
    pauseReason: '8587-acceptance-pause',
    actor: '8587-acceptance-harness',
  });
  assert(paused?.ok === true && paused.runtime?.pause?.active === true, 'pause control did not activate', paused);
  const pausedTick = await postJson('/api/agent-live-loop/tick', {
    reason: '8587-acceptance-paused-tick',
    force: true,
  });
  assert((pausedTick.skipped || []).some((item) => item?.reason === 'loop-paused'), 'paused loop should skip new turns', pausedTick);
  assert(!pausedTick.actionsCreated?.length, 'paused loop should not create actions', pausedTick);

  const kill = await postJson('/api/agent-live-loop', {
    clearPause: true,
    killSwitchActive: true,
    killSwitchReason: '8587-acceptance-kill-switch',
    actor: '8587-acceptance-harness',
  });
  assert(kill?.ok === true && kill.runtime?.killSwitch?.active === true, 'kill switch did not activate', kill);
  const killedTick = await postJson('/api/agent-live-loop/tick', {
    reason: '8587-acceptance-kill-switch-tick',
    force: true,
  });
  assert((killedTick.skipped || []).some((item) => item?.reason === 'kill-switch-active'), 'kill switch should skip new turns', killedTick);
  assert(!killedTick.actionsCreated?.length, 'kill switch should not create actions', killedTick);

  const cleared = await postJson('/api/agent-live-loop', {
    clearPause: true,
    clearKillSwitch: true,
    actor: '8587-acceptance-harness',
  });
  assert(cleared?.ok === true && cleared.runtime?.killSwitch?.active === false && cleared.runtime?.pause?.active === false, 'operator controls did not clear cleanly', cleared);
  console.log('PASS: operator pause and kill switch both stop new turns and clear cleanly.');
  return { paused, pausedTick, kill, killedTick, cleared };
}

async function verifyAutonomyMetrics({ expectedTurns }) {
  const metrics = await fetchJson('/api/live-agent-mode/metrics');
  assert(metrics?.ok === true, 'Live Agent metrics endpoint failed', metrics);
  assert(metrics.metrics?.completedTurnCount >= expectedTurns, `metrics should show at least ${expectedTurns} completed turns`, metrics.metrics);
  assert(metrics.metrics?.completedBackendActionCount >= expectedTurns, `metrics should show at least ${expectedTurns} backend-owned completed actions`, metrics.metrics);
  assert(metrics.metrics?.routePendingActiveCount === 0, 'metrics should show no active route_pending actions', metrics.metrics);
  assert(metrics.checklist?.browserFreeBackendCompletions === true, 'metrics checklist should confirm browser-free backend completion', metrics.checklist);
  assert(metrics.checklist?.movementPersisted === true, 'metrics checklist should confirm persisted movement', metrics.checklist);
  assert(metrics.checklist?.threeTypedObjectUses === true, 'metrics checklist should confirm at least three typed object-use actions', metrics.checklist);
  assert(metrics.checklist?.buildEffectPersisted === true, 'metrics checklist should confirm build effects persisted', metrics.checklist);
  assert(metrics.checklist?.animationReplayReady === true, 'metrics checklist should confirm replay readiness', metrics.checklist);
  assert(metrics.checklist?.spatialOrWorldCommunication === true, 'metrics checklist should confirm in-world communication', metrics.checklist);
  assert(metrics.checklist?.reactionOpportunitiesCreated === true, 'metrics checklist should confirm reaction opportunities', metrics.checklist);
  assert(metrics.checklist?.memoryUpdated === true, 'metrics checklist should confirm memory updates', metrics.checklist);
  assert(metrics.metrics?.memory?.stream > 0, 'metrics memory stream count should be positive', metrics.metrics?.memory);
  assert(metrics.metrics?.memory?.reflections > 0, 'metrics should report at least one memory reflection', metrics.metrics?.memory);
  assert(metrics.checklist?.relationshipsUpdated === true, 'metrics checklist should confirm relationship updates', metrics.checklist);
  assert(metrics.checklist?.providerAdapterReadiness === true, 'metrics checklist should confirm provider adapter readiness', metrics.checklist);
  assert(metrics.checklist?.clawMindModuleContractsReady === true, 'metrics checklist should confirm ClawMind module contracts', metrics.checklist);
  assert(metrics.checklist?.lightweightMetricsOptimized === true, 'metrics checklist should confirm lightweight metrics optimization', metrics.checklist);
  assert(metrics.providerSupport?.schemaVersion === 'agent-live-mode-provider-adapter-contract/v1', 'provider support metrics should use the adapter contract schema', metrics.providerSupport);
  assert(metrics.providerSupport?.providerKindCount >= 1, 'provider support metrics should include at least one provider kind', metrics.providerSupport);
  assert(metrics.providerSupport?.optimization?.providerCallsDuringMetrics === 0, 'provider support metrics must not call providers', metrics.providerSupport?.optimization);
  assert(metrics.providerSupport?.optimization?.modelCallsDuringMetrics === 0, 'provider support metrics must not call models', metrics.providerSupport?.optimization);
  assert(metrics.clawMindArchitecture?.schemaVersion === 'agent-live-mode-clawmind-architecture/v1', 'ClawMind metrics should use the architecture schema', metrics.clawMindArchitecture);
  assert(metrics.clawMindArchitecture?.checklist?.allModuleContractsReady === true, 'ClawMind metrics should confirm all module contracts', metrics.clawMindArchitecture);
  assert(metrics.clawMindArchitecture?.checklist?.allModulesExecuted === true, 'ClawMind metrics should confirm all modules executed', metrics.clawMindArchitecture);
  for (const [moduleName, moduleMetrics] of Object.entries(metrics.clawMindArchitecture?.modules || {})) {
    assert(moduleMetrics?.runtimeEvidence === true, `ClawMind module ${moduleName} should have runtime evidence`, moduleMetrics);
    assert(Number(moduleMetrics?.executionCount || 0) > 0, `ClawMind module ${moduleName} should report execution count`, moduleMetrics);
    assert(moduleMetrics?.lastExecutionAt, `ClawMind module ${moduleName} should report last execution time`, moduleMetrics);
    assert(typeof moduleMetrics?.lastLatencyMs === 'number', `ClawMind module ${moduleName} should report latency`, moduleMetrics);
  }
  assert(metrics.clawMindArchitecture?.optimization?.heavyWorldScan === false, 'ClawMind metrics must stay lightweight', metrics.clawMindArchitecture?.optimization);
  console.log(`PASS: autonomy metrics ${JSON.stringify({
    completedTurnCount: metrics.metrics.completedTurnCount,
    completedBackendActionCount: metrics.metrics.completedBackendActionCount,
    typedObjectActionTypes: metrics.metrics.typedObjectActionTypes,
    inWorldCommunicationCount: metrics.metrics.inWorldCommunicationCount,
    reactionOpportunityCount: metrics.metrics.reactionOpportunityCount,
    relationshipCount: metrics.metrics.relationshipCount,
    memory: metrics.metrics.memory,
    providerKindCount: metrics.providerSupport.providerKindCount,
    clawMindContractGaps: metrics.clawMindArchitecture.contractGaps,
    clawMindRuntimeEvidenceGaps: metrics.clawMindArchitecture.runtimeEvidenceGaps,
    gaps: metrics.gaps,
  })}`);
  return metrics;
}

function runChild(command, args, { input, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...(env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed with ${signal || code}\n${stdout}${stderr}`));
      }
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function runBrowserReplayRenderCheck(actionId) {
  const script = String.raw`
import json
import os
from playwright.sync_api import sync_playwright

base_url = os.environ["VW_ACCEPTANCE_BASE_URL"]
action_id = os.environ["VW_ACCEPTANCE_ACTION_ID"]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
    page = browser.new_page(viewport={"width": 960, "height": 640}, device_scale_factor=1)
    page.goto(base_url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_selector("#pixiContainer canvas", timeout=30000)
    page.wait_for_function("() => typeof window.__VWReplayLiveAgentModeAnimationEvents === 'function' && typeof window.__VWScene === 'function'", timeout=30000)
    result = page.evaluate("""
async ({ actionId }) => {
  const expectedNames = ['agent-move-started', 'agent-arrived', 'object-use-started', 'object-use-completed', 'world-action-completed'];
  let lastState = null;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await window.__VWReplayLiveAgentModeAnimationEvents({ actionId, force: true, limit: 50 });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const state = window.__VWLiveAgentModeAnimationReplayState || {};
    const actionState = state.actions?.[actionId] || null;
    const eventNames = new Set(actionState?.eventNames || []);
    const scene = window.__VWScene?.();
    const replayGroup = scene?.getObjectByName?.('vw-live-agent-mode-replay-' + actionId) || null;
    const agent = (window.agents || []).find(candidate => String(candidate?.id || candidate?.statusKey || '') === 'acceptance-agent') || null;
    const canvas = document.querySelector('#pixiContainer canvas');
    const canvasRect = canvas?.getBoundingClientRect?.();
    const rendererInfo = window.__VWRenderInfo?.() || {};
    const hasExpectedEvents = expectedNames.every(name => eventNames.has(name));
    const groupChildCount = replayGroup?.children?.length || 0;
    const agentRendered = Boolean(actionState?.agentRendered && agent?._group3d && Number.isFinite(agent._group3d.position.x) && Number.isFinite(agent._group3d.position.z));
    const canvasRendered = Boolean(canvasRect && canvasRect.width > 100 && canvasRect.height > 100 && Number(rendererInfo.calls || 0) > 0);
    lastState = {
      ok: Boolean(state.ok && actionState && hasExpectedEvents && groupChildCount >= 2 && agentRendered && canvasRendered),
      actionId,
      eventCount: actionState?.eventCount || 0,
      renderedEventCount: actionState?.renderedEventCount || 0,
      groupChildCount,
      eventNames: Array.from(eventNames).sort(),
      agentRendered,
      agentPosition: actionState?.lastAgentPosition || null,
      sceneGroupName: replayGroup?.name || null,
      rendererCalls: rendererInfo.calls || 0,
      canvas: canvasRect ? { width: canvasRect.width, height: canvasRect.height } : null,
      pageUrl: window.location.href,
      replaySource: state.source || null,
    };
    if (lastState.ok) return lastState;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('real product replay/render state did not settle: ' + JSON.stringify(lastState));
}
""", {"actionId": action_id})
    browser.close()

if not result.get("ok"):
    raise AssertionError(result)
print(json.dumps(result, sort_keys=True))
`;
  const { stdout } = await runChild('python3', ['-'], {
    input: script,
    env: {
      VW_ACCEPTANCE_BASE_URL: BASE_URL,
      VW_ACCEPTANCE_ACTION_ID: actionId,
    },
  });
  const resultText = stdout.trim().split('\n').at(-1);
  const result = JSON.parse(resultText);
  assert(result.ok === true, 'browser replay/render check failed', result);
  assert(String(result.pageUrl || '').startsWith(BASE_URL), 'browser replay/render check did not run on the 8587 app', result);
  assert(result.sceneGroupName, 'browser replay/render check did not use a real product scene replay group', result);
  console.log(`PASS: browser replay/render check used product client scene replay group ${result.sceneGroupName} with ${result.renderedEventCount} rendered events for ${actionId} on ${BASE_URL}.`);
  return result;
}

assertNoProductPortTargets();
assertNoConflictingHarnessPortEnv();
await assertPortAvailable(TEST_PORT);

const dataDir = mkdtempSync(join(tmpdir(), 'vw-live-agent-mode-8587-'));
const workspaceRoot = join(dataDir, 'openclaw');
writeAcceptanceWorkspace(workspaceRoot);
const childEnv = {
  ...process.env,
  PYTHONDONTWRITEBYTECODE: '1',
  _VW_INT: '1',
  VW_PORT: String(TEST_PORT),
  VW_HOST_PORT: String(TEST_PORT),
  VW_PUBLIC_ORIGIN: BASE_URL,
  VW_DATA_DIR: dataDir,
  VW_OPENCLAW_PATH: workspaceRoot,
  VW_OPENCLAW_HOST_PATH: workspaceRoot,
  VW_GATEWAY_URL: '',
  VW_HERMES_ENABLED: 'false',
  VW_CODEX_ENABLED: 'false',
};

const server = spawn('python3', ['-B', 'src/server/server.py'], {
  cwd: process.cwd(),
  env: childEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
const appendOutput = (chunk, stream) => {
  const text = chunk.toString();
  serverOutput = `${serverOutput}${text}`.slice(-8000);
  if (keepOpen) stream.write(text);
};
server.stdout.on('data', (chunk) => appendOutput(chunk, process.stdout));
server.stderr.on('data', (chunk) => appendOutput(chunk, process.stderr));

let cleaned = false;
const cleanup = async () => {
  if (cleaned) return;
  cleaned = true;
  await stopServer(server);
  rmSync(dataDir, { recursive: true, force: true });
};

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await cleanup();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

try {
  const health = await waitForHealth(server, () => serverOutput);
  if (health.dataDir !== dataDir) {
    throw new Error(`expected isolated dataDir ${dataDir}, got ${health.dataDir || '<empty>'}`);
  }
  console.log(`PASS: Live Agent Mode harness verified ${BASE_URL}/healthz with isolated data at ${dataDir}.`);

  await enableGlobalAgentLiveModeFeature();
  await seedAcceptanceWorld();
  const backendSeries = await verifyNoBrowserBackendTurnSeries(ACCEPTANCE_TURN_TARGET);
  await verifyTypedObjectActions();
  await verifySocialCommunicationAndMemory();
  await verifyOperatorControlsStopTurns();
  await verifyAutonomyMetrics({ expectedTurns: ACCEPTANCE_TURN_TARGET });
  await runBrowserReplayRenderCheck(backendSeries.proofs[0].actionId);

  if (keepOpen) {
    console.log(`Serving isolated Live Agent Mode harness at ${BASE_URL}. Press Ctrl-C to stop.`);
    await new Promise((resolve, reject) => {
      server.once('exit', (code, signal) => {
        if (code === 0 || signal === 'SIGTERM') resolve();
        else reject(new Error(`server exited with code ${code || signal}\n${serverOutput}`));
      });
    });
  }
} finally {
  if (!keepOpen) {
    await cleanup();
  }
}
