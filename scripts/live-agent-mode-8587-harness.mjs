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
const HERMES_FIXTURE_AGENT_ID = 'acceptance-hermes';
const CODEX_FIXTURE_AGENT_ID = 'acceptance-codex';
const FAKE_FIXTURE_AGENT_ID = 'acceptance-fake-provider';
const OFFICE_BUILDING_ID = 'acceptance-office';
const HOME_BUILDING_ID = 'acceptance-home';
const WATER_COOLER_ID = 'acceptance-water-cooler';
const COFFEE_MACHINE_ID = 'acceptance-coffee-machine';
const VENDING_ID = 'acceptance-vending';
const WHITEBOARD_ID = 'acceptance-whiteboard';
const PRINTER_ID = 'acceptance-printer';
const MICROWAVE_ID = 'acceptance-microwave';
const ACCEPTANCE_TURN_TARGET = Math.max(1, Number.parseInt(process.env.VW_LIVE_AGENT_MODE_ACCEPTANCE_TURNS || process.env.VW_LIVE_AGENT_MODE_SOAK_TURNS || '100', 10) || 100);
const SOAK_AGENT_COUNT = Math.max(2, Number.parseInt(process.env.VW_LIVE_AGENT_MODE_SOAK_AGENT_COUNT || process.env.VW_LIVE_AGENT_MODE_ACCEPTANCE_AGENTS || '5', 10) || 5);
const REQUEST_TIMEOUT_MS = Math.max(30000, Number.parseInt(process.env.VW_LIVE_AGENT_MODE_8587_REQUEST_TIMEOUT_MS || '60000', 10) || 60000);
const EXTRA_SOAK_AGENT_IDS = Array.from({ length: Math.max(0, SOAK_AGENT_COUNT - 2) }, (_, index) => `acceptance-soak-${index + 3}`);
const SOAK_AGENT_IDS = [TEST_AGENT_ID, PEER_AGENT_ID, ...EXTRA_SOAK_AGENT_IDS];
const keepOpen = process.argv.includes('--keep-open');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Usage:
  npm run verify:live-agent-mode:8587
  npm run dev:live-agent-mode:8587

The harness starts My Virtual World on ${BASE_URL} with temporary data,
checks /healthz, proves a backend Live Agent Mode turn can finish without
a browser, runs a configurable multi-agent soak (${SOAK_AGENT_COUNT} agents,
${ACCEPTANCE_TURN_TARGET} backend turns by default), runs autonomy metrics,
runs a browser replay/render check against emitted animation
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

function compactTickResult(tick) {
  const skipped = Array.isArray(tick?.skipped) ? tick.skipped : [];
  return {
    ok: tick?.ok,
    reason: tick?.reason,
    forced: tick?.forced,
    actionsCreated: Array.isArray(tick?.actionsCreated) ? tick.actionsCreated.length : 0,
    skipped: skipped.map((item) => ({
      agentId: item?.agentId,
      reason: item?.reason,
      activeCount: Array.isArray(item?.active) ? item.active.length : undefined,
      activeActionIds: Array.isArray(item?.active) ? item.active.map((active) => active?.id || active?.actionId).filter(Boolean).slice(0, 5) : undefined,
      nextAllowedAt: item?.nextAllowedAt,
    })),
    errors: Array.isArray(tick?.errors) ? tick.errors.map((item) => ({ agentId: item?.agentId, httpStatus: item?.httpStatus, error: item?.error })) : [],
    worldClient: tick?.worldClient ? {
      active: tick.worldClient.active,
      sessionId: tick.worldClient.client?.sessionId,
      source: tick.worldClient.source,
      ageSec: tick.worldClient.ageSec,
    } : null,
    scheduler: tick?.scheduler ? {
      lastAgentId: tick.scheduler.lastAgentId,
      turnSequence: tick.scheduler.turnSequence,
      activeTurn: tick.scheduler.activeTurn ? {
        agentId: tick.scheduler.activeTurn.agentId,
        status: tick.scheduler.activeTurn.status,
        id: tick.scheduler.activeTurn.id,
      } : null,
    } : null,
  };
}

function skippedReasons(tick) {
  return (Array.isArray(tick?.skipped) ? tick.skipped : [])
    .map((item) => item?.reason)
    .filter(Boolean);
}

function isTransientBackendTurnSkip(tick) {
  const reasons = new Set(skippedReasons(tick));
  if (reasons.has('world-client-inactive') || (Array.isArray(tick?.errors) && tick.errors.length > 0)) {
    return false;
  }
  return reasons.has('active-behavior') || reasons.has('active-turn-running');
}

async function requestJson(path, { method = 'GET', body } = {}) {
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
        const error = new Error(`${path} returned HTTP ${response.status}${payload ? `\n${JSON.stringify(payload, null, 2)}` : ''}`);
        error.status = response.status;
        error.path = path;
        error.payload = payload;
        throw error;
      }
      return payload;
    } catch (error) {
      const transientSocketClose = error instanceof TypeError
        && error.message === 'fetch failed'
        && error.cause?.code === 'UND_ERR_SOCKET';
      if (attempt < maxAttempts && transientSocketClose) {
        await delay(250);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function fetchJson(path) {
  return requestJson(path);
}

async function postJson(path, body) {
  return requestJson(path, { method: 'POST', body });
}

async function disableDayNightCycleFor8587() {
  const result = await postJson('/api/meta', { dayNightCycleEnabled: false });
  assert(result?.ok === true, 'failed to disable day/night cycle on 8587 before browser verification', result);
  console.log('PASS: disabled day/night cycle on isolated 8587 before browser verification.');
  return result;
}

async function postJsonExpectStatus(path, body, expectedStatus) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  assert(response.status === expectedStatus, `${path} returned HTTP ${response.status}, expected ${expectedStatus}`, payload);
  return payload;
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
  for (const [index, agentId] of SOAK_AGENT_IDS.entries()) {
    const agentDir = join(workspaceRoot, 'agents', agentId, 'agent');
    const displayName = agentId === TEST_AGENT_ID
      ? 'Acceptance Agent'
      : agentId === PEER_AGENT_ID
        ? 'Acceptance Peer'
        : `Acceptance Soak ${index + 1}`;
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'IDENTITY.md'), [
      `# ${displayName}`,
      '',
      `- **Name:** ${displayName}`,
      `- **Emoji:** ${index + 1}`,
      '- **Role:** Isolated Live Agent Mode soak fixture',
      '',
    ].join('\n'));
  }
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
  const agentAssignments = {};
  const agentProfiles = {
    [HERMES_FIXTURE_AGENT_ID]: {
      name: 'Acceptance Hermes Fixture',
      providerKind: 'hermes',
      providerType: 'profile-backed',
      providerAgentId: 'acceptance-hermes',
      agentLiveModeEnabled: false,
      capabilities: ['observe', 'decide', 'propose', 'toolCallResult'],
    },
    [CODEX_FIXTURE_AGENT_ID]: {
      name: 'Acceptance Codex Fixture',
      providerKind: 'codex',
      providerType: 'profile-backed',
      providerAgentId: 'acceptance-codex',
      agentLiveModeEnabled: false,
      capabilities: ['observe', 'decide', 'propose', 'toolCallResult'],
    },
    [FAKE_FIXTURE_AGENT_ID]: {
      name: 'Acceptance Fake Provider',
      providerKind: 'fake',
      providerType: 'profile-backed',
      providerAgentId: 'acceptance-fake',
      agentLiveModeEnabled: false,
      capabilities: ['observe', 'decide', 'propose', 'toolCallResult'],
    },
  };
  const agentLocations = {};
  const loopAgents = {};
  for (const [index, agentId] of SOAK_AGENT_IDS.entries()) {
    agentAssignments[agentId] = {
      work: OFFICE_BUILDING_ID,
      ...(agentId === TEST_AGENT_ID ? { home: HOME_BUILDING_ID } : {}),
    };
    agentProfiles[agentId] = {
      name: agentId === TEST_AGENT_ID ? 'Acceptance Agent' : agentId === PEER_AGENT_ID ? 'Acceptance Peer' : `Acceptance Soak ${index + 1}`,
      agentLiveModeEnabled: true,
      roles: agentId === TEST_AGENT_ID
        ? ['acceptance resident', 'social initiator']
        : agentId === PEER_AGENT_ID
          ? ['acceptance resident', 'social peer']
          : ['acceptance resident', 'soak participant'],
      personality: {
        outgoing: Math.min(0.9, 0.35 + (index * 0.08)),
        curious: Math.min(0.9, 0.45 + (index * 0.05)),
        easygoing: Math.max(0.2, 0.8 - (index * 0.06)),
      },
    };
    agentLocations[agentId] = agentId === TEST_AGENT_ID
      ? {
          source: '8587-acceptance-seed',
          agentId,
          buildingId: HOME_BUILDING_ID,
          floor: 1,
          x: -7,
          z: -7,
          apiX: -280,
          apiZ: -280,
          updatedAt: now,
        }
      : {
          source: '8587-acceptance-seed',
          agentId,
          buildingId: OFFICE_BUILDING_ID,
          floor: 1,
          x: 15 + index,
          z: 10 + (index % 3),
          apiX: (15 + index) * 40,
          apiZ: (10 + (index % 3)) * 40,
          updatedAt: now,
        };
    loopAgents[agentId] = {
      enabled: true,
      lastNeedUpdateAt: now,
      needs: {
        hydration: index % 5 === 0 ? 0.95 : 0.2 + ((index % 4) * 0.12),
        food: index % 5 === 1 ? 0.9 : 0.15 + ((index % 3) * 0.12),
        energy: index % 5 === 2 ? 0.85 : 0.15,
        curiosity: index % 5 === 3 ? 0.9 : 0.2,
        maintenance: index % 5 === 4 ? 0.9 : 0.2,
        shelter: agentId === TEST_AGENT_ID ? 0.1 : 0.2,
        social: agentId === PEER_AGENT_ID ? 0.9 : 0.25 + ((index % 2) * 0.2),
      },
    };
  }
  const seeded = await postJson('/api/meta', {
    initialized: true,
    name: '8587 Live Agent Mode Acceptance',
    agentAssignments,
    agentProfiles,
    agentLife: {
      simulation: {
        schemaVersion: 'agent-live-mode-simulation/v1',
        updatedAt: now,
        agentLocations,
      },
      liveModeLoop: {
        schemaVersion: 'agent-live-mode-loop/v1',
        enabled: false,
        intervalSec: 300,
        worldClientRequired: false,
        minActionIntervalSec: 30,
        maxActionsPerTick: 1,
        maxToolCallsPerTurn: 1,
        agents: loopAgents,
      },
    },
  });
  assert(seeded?.ok === true, 'failed to seed acceptance world metadata', seeded);

  const liveMode = await postJson(`/api/agent/${encodeURIComponent(TEST_AGENT_ID)}/live-mode`, {
    agentLiveModeEnabled: true,
  });
  assert(liveMode?.ok === true && liveMode.agentLiveModeEnabled === true, 'failed to enable Live Agent Mode for acceptance agent', liveMode);
  const peerLiveMode = await postJson(`/api/agent/${encodeURIComponent(PEER_AGENT_ID)}/live-mode`, {
    agentLiveModeEnabled: true,
  });
  assert(peerLiveMode?.ok === true && peerLiveMode.agentLiveModeEnabled === true, 'failed to enable Live Agent Mode for acceptance peer', peerLiveMode);

  const loopSettings = await postJson('/api/agent-live-loop', {
    enabled: false,
    worldClientRequired: false,
    intervalSec: 300,
    clearWorldClientActivity: true,
    clearPause: true,
    clearKillSwitch: true,
    maxActionsPerTick: 1,
    maxToolCallsPerTurn: 1,
    minActionIntervalSec: 30,
    agentId: TEST_AGENT_ID,
    agentEnabled: true,
    clearTurnRetry: true,
  });
  assert(loopSettings?.ok === true, 'failed to configure Live Agent Mode loop for acceptance', loopSettings);

  const peerLoopSettings = await postJson('/api/agent-live-loop', {
    agentId: PEER_AGENT_ID,
    agentEnabled: true,
    clearTurnRetry: true,
    actor: '8587-acceptance-harness',
  });
  assert(peerLoopSettings?.ok === true, 'failed to configure peer Live Agent Mode loop for acceptance', peerLoopSettings);

  for (const agentId of EXTRA_SOAK_AGENT_IDS) {
    const liveModeResult = await postJson(`/api/agent/${encodeURIComponent(agentId)}/live-mode`, {
      agentLiveModeEnabled: true,
    });
    assert(liveModeResult?.ok === true && liveModeResult.agentLiveModeEnabled === true, `failed to enable Live Agent Mode for soak agent ${agentId}`, liveModeResult);
    const loopResult = await postJson('/api/agent-live-loop', {
      agentId,
      agentEnabled: true,
      clearTurnRetry: true,
      actor: '8587-acceptance-harness',
    });
    assert(loopResult?.ok === true, `failed to configure soak agent ${agentId} for acceptance`, loopResult);
  }

  console.log(`PASS: seeded ${SOAK_AGENT_IDS.length} Live Agent Mode soak agents for ${ACCEPTANCE_TURN_TARGET} backend turns.`);
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

async function verifyNoBrowserBackendTurn(reason = '8587-acceptance-no-browser', { allowTransientSkip = false } = {}) {
  const before = await fetchJson('/api/agent-live-loop');
  if (before?.runtime?.worldClient?.active === true) {
    console.log(`WARN: ignoring existing 8587 browser client ${before.runtime.worldClient?.client?.sessionId || '<unknown>'}; scheduler guardrail must still allow backend progress.`);
  }
  assert(before?.runtime?.guardrails?.browserTabRequiredForScheduler === false, 'expected scheduler guardrail to allow no-browser progression', before?.runtime?.guardrails);

  const tick = await postJson('/api/agent-live-loop/tick', {
    reason,
    force: true,
  });
  assert(tick?.ok === true, 'Live Agent Mode backend tick failed', tick);
  assert(!(tick?.skipped || []).some((item) => item?.reason === 'world-client-inactive'), 'backend tick unexpectedly depended on an active browser client', tick);
  if (!Array.isArray(tick.actionsCreated) || tick.actionsCreated.length < 1) {
    const compact = compactTickResult(tick);
    if (allowTransientSkip && isTransientBackendTurnSkip(tick)) {
      console.log(`WARN: retrying transient backend turn skip ${JSON.stringify(compact.skipped)}`);
      return { skipped: true, tick: compact };
    }
    assert(false, 'backend tick did not create an action', compact);
  }
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
  const transientSkips = [];
  const maxAttempts = targetCount + Math.max(20, SOAK_AGENT_IDS.length * 6);
  for (let attempt = 0; proofs.length < targetCount && attempt < maxAttempts; attempt += 1) {
    const turnNumber = proofs.length + 1;
    const proof = await verifyNoBrowserBackendTurn(`8587-acceptance-no-browser-${turnNumber}-attempt-${attempt + 1}`, { allowTransientSkip: true });
    if (proof?.skipped) {
      transientSkips.push(proof.tick);
      await delay(250);
      continue;
    }
    proofs.push(proof);
    if (proof.action?.actionType) actionTypes.add(proof.action.actionType);
  }
  assert(proofs.length >= targetCount, `only completed ${proofs.length}/${targetCount} no-browser backend turns before retry budget was exhausted`, { targetCount, maxAttempts, transientSkips: transientSkips.slice(-5) });
  console.log(`PASS: ${proofs.length}/${targetCount} no-browser backend turns completed with action types: ${Array.from(actionTypes).sort().join(', ')}${transientSkips.length ? ` after ${transientSkips.length} transient retry skips` : ''}`);
  return { proofs, actionTypes: Array.from(actionTypes).sort(), transientSkips };
}

function liveAgentSource(requestId) {
  return {
    kind: 'agent-live-mode',
    requestId,
    surface: '8587-acceptance-harness',
    roles: ['participant'],
  };
}

function worldActionAgentId(action) {
  return action?.agentId || action?.actor?.id || action?.agent?.id || action?.source?.agentId || '';
}

async function waitForAgentWorldActionIdle(agentId, context) {
  let lastActive = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const active = await fetchJson('/api/world-actions/active');
    assert(Array.isArray(active), 'active world actions response was not a list', active);
    lastActive = active.filter((action) => worldActionAgentId(action) === agentId);
    if (lastActive.length === 0) return;
    await delay(250);
  }
  throw new Error(`${context || 'agent'} still has active world actions for ${agentId}\n${JSON.stringify(lastActive, null, 2)}`);
}

async function waitForLiveAgentSchedulerIdle(context, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const status = await fetchJson('/api/agent-live-loop');
    const activeTurn = status?.runtime?.scheduler?.activeTurn || status?.state?.scheduler?.activeTurn || null;
    if (!activeTurn || activeTurn.status !== 'running') return;
    last = activeTurn;
    await postJson('/api/agent-live-loop/tick', {
      reason: `${context || '8587-wait-scheduler-idle'}-recover`,
      force: true,
    });
    await delay(1000);
  }
  throw new Error(`${context || 'scheduler'} still has an active live-agent turn\n${JSON.stringify(last, null, 2)}`);
}

async function requestLiveAgentAction({ actionType, capabilityTag, target, params = {}, agentId = TEST_AGENT_ID, requestId }) {
  await waitForAgentWorldActionIdle(agentId, `before ${actionType}`);
  let result = null;
  const body = {
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
  };
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      result = await postJson('/api/agent-model/actions', body);
      break;
    } catch (error) {
      const errorCode = error?.payload?.error?.code;
      const detailCode = error?.payload?.error?.details?.error?.code;
      const transitionDetails = error?.payload?.error?.details?.error?.details || {};
      const transientBackendRace = errorCode === 'backend_executor_failed' && (
        detailCode === 'not_found'
        || (detailCode === 'illegal_transition' && transitionDetails.from === 'routing' && transitionDetails.to === 'in_progress')
      );
      if (attempt < maxAttempts && transientBackendRace) {
        console.log(`INFO: retrying transient backend executor race for ${actionType}.`);
        await delay(350);
        continue;
      }
      throw error;
    }
  }
  assert(result?.ok === true, `Live Agent action request failed for ${actionType}`, result);
  const action = result.action || result.worldAction?.action;
  assert(action?.status === 'completed', `Live Agent action ${actionType} did not complete`, action || result);
  assert(action?.execution?.clientRequiredForProgress === false, `Live Agent action ${actionType} should be backend-owned`, action?.execution);
  await waitForAgentWorldActionIdle(agentId, `after ${actionType}`);
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

async function waitForCommunicationEvent(eventId) {
  let last = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const communications = await fetchJson('/api/live-agent-mode/in-world-communications?limit=50');
    last = communications;
    const event = (communications.events || []).find((item) => item?.id === eventId);
    if (event) return { communications, event };
    await delay(250);
  }
  throw new Error(`communication log did not persist event ${eventId}\n${JSON.stringify(last, null, 2)}`);
}

async function verifyFakeProviderBridgeContract() {
  const enabled = await postJson(`/api/agent/${encodeURIComponent(FAKE_FIXTURE_AGENT_ID)}/live-mode`, {
    agentLiveModeEnabled: true,
  });
  assert(enabled?.ok === true && enabled.agentLiveModeEnabled === true, 'failed to enable fake provider fixture for bridge contract', enabled);

  try {
    const rejected = await postJsonExpectStatus('/api/agent-model/actions', {
      agentId: FAKE_FIXTURE_AGENT_ID,
      source: liveAgentSource('8587-acceptance-fake-provider-proposal'),
      actionType: 'world.modifyRoad',
      capabilityTag: 'world.terrain',
      target: { kind: 'world-point', x: 0, z: 0 },
      priority: 'normal',
      params: {
        reason: '8587-provider-bridge-contract',
      },
    }, 422);
    const proposalId = rejected?.error?.details?.operatorProposal?.id;
    assert(proposalId, 'proposal-only fake provider request should return an operator proposal reference', rejected);

    const proposals = await fetchJson(`/api/agent-live-loop/proposals?agentId=${encodeURIComponent(FAKE_FIXTURE_AGENT_ID)}&includeResolved=true&limit=10`);
    const proposal = (proposals.proposals || []).find((item) => item?.id === proposalId);
    assert(proposal?.providerBridge?.providerKind === 'fake', 'fake provider proposal should retain bridge metadata', { proposalId, proposal });

    const metrics = await fetchJson('/api/live-agent-mode/metrics');
    const fake = metrics.providerSupport?.providerKinds?.fake;
    assert(fake?.capabilities?.operations?.observe === true, 'fake provider bridge should expose observe capability', fake);
    assert(fake?.capabilities?.operations?.decide === true, 'fake provider bridge should expose decide capability', fake);
    assert(fake?.capabilities?.operations?.propose === true, 'fake provider bridge should expose propose capability', fake);
    assert(fake?.capabilities?.operations?.toolCallResult === true, 'fake provider bridge should expose tool result capability', fake);
    assert(fake?.bridge?.stats?.proposeCalls >= 1, 'fake provider bridge should record proposal calls', fake?.bridge);
    assert(fake?.bridge?.stats?.fallbacks >= 1, 'fake provider bridge should record deterministic fallback for proposal calls', fake?.bridge);
    assert(Array.isArray(metrics.providerSupport?.capabilityGapsByProvider?.fake), 'fake provider bridge should report capability gaps list', metrics.providerSupport?.capabilityGapsByProvider);
    console.log(`PASS: fake provider bridge contract recorded proposal ${proposalId} without model calls.`);
    return { proposalId, metrics };
  } finally {
    const disabled = await postJson(`/api/agent/${encodeURIComponent(FAKE_FIXTURE_AGENT_ID)}/live-mode`, {
      agentLiveModeEnabled: false,
    });
    assert(disabled?.ok === true && disabled.agentLiveModeEnabled === false, 'failed to disable fake provider fixture after bridge contract', disabled);
    const loopDisabled = await postJson('/api/agent-live-loop', {
      agentId: FAKE_FIXTURE_AGENT_ID,
      agentEnabled: false,
      clearTurnRetry: true,
      actor: '8587-acceptance-fake-provider-complete',
    });
    assert(loopDisabled?.ok === true, 'failed to disable fake provider loop state after bridge contract', loopDisabled);
  }
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
  const speechEvent = speech.toolCall?.result?.communicationEvent;
  assert(speechEvent?.id && speechEvent.targetAgentId === PEER_AGENT_ID, 'say_to_agent should return the peer-targeted communication event', speech);
  const { communications } = await waitForCommunicationEvent(speechEvent.id);

  const memory = await executeLiveAgentTool('add_memory', {
    text: 'Acceptance harness confirmed backend-owned Live Agent Mode can communicate and remember.',
    importance: 'high',
    tags: ['acceptance', 'autonomy'],
  }, { requestId: '8587-acceptance-add-memory' });
  assert(memory.toolCall?.result?.memoryEntry?.id, 'add_memory should persist a memory entry', memory);
  assert(memory.toolCall?.result?.streamEntry?.id, 'add_memory should append to the memory stream', memory);
  const memoryReflectionId = memory.toolCall?.result?.reflection?.id || memory.toolCall?.result?.state?.memory?.reflections?.at?.(-1)?.id;
  assert(memoryReflectionId, 'memory state should include a synthesized reflection from accumulated stream entries', memory);

  assert((communications.events || []).some((event) => event.targetAgentId === PEER_AGENT_ID), 'communication log should include the peer-targeted event', communications);

  const retrieved = await fetchJson(`/api/live-agent-mode/memory/${encodeURIComponent(TEST_AGENT_ID)}?query=${encodeURIComponent('communicate remember acceptance')}&limit=5`);
  assert(retrieved?.ok === true, 'memory retrieval endpoint should return ok', retrieved);
  assert((retrieved.results || []).length >= 1, 'memory retrieval should return ranked results', retrieved);
  assert(typeof retrieved.results[0]?.retrieval?.score === 'number', 'memory retrieval should include deterministic scores', retrieved.results?.[0]);
  assert(retrieved.memory?.counts?.stream >= 2, 'memory stream should include conversation and memory entries', retrieved.memory?.counts);
  assert(retrieved.memory?.counts?.reflections > 0, 'memory endpoint should report synthesized reflections', retrieved.memory?.counts);

  console.log(`PASS: social target ${social.action.id}, in-world speech ${speech.toolCall.id}, memory ${memory.toolCall.result.memoryEntry.id}, and reflection ${memoryReflectionId} verified.`);
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

async function verifyFailureInjectionReplanning() {
  const configured = await postJson('/api/agent-live-loop', {
    enabled: false,
    clearPause: true,
    clearKillSwitch: true,
    agentId: TEST_AGENT_ID,
    failureInjection: {
      agentId: TEST_AGENT_ID,
      mode: 'expected-outcome-mismatch',
      reason: '8587 failure-injection replanning assertion',
      remaining: 1,
      requestedBy: '8587-acceptance-harness',
    },
    actor: '8587-acceptance-harness',
    clearTurnRetry: true,
  });
  assert(configured?.ok === true, 'failed to configure expected-outcome failure injection', configured);
  assert(configured.changed?.failureInjection?.remaining === 1, 'failure injection setting was not activated', configured.changed);
  await waitForLiveAgentSchedulerIdle('8587-before-failure-injection');

  const runTargetAgentTick = async (reason, predicate, attempts = 10) => {
    const misses = [];
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const tick = await postJson('/api/agent-live-loop/tick', {
        reason: `${reason}-${attempt}`,
        force: true,
      });
      assert(tick?.ok === true, `${reason} tick failed`, tick);
      const action = tick.actionsCreated?.[0];
      if (action?.agentId === TEST_AGENT_ID && (!predicate || predicate(action, tick))) {
        return { tick, action };
      }
      const activeTurnRunning = (tick.skipped || []).some((item) => item?.reason === 'active-turn-running');
      misses.push({ attempt, agentId: action?.agentId, actionId: action?.actionId, loopActionId: action?.loopActionId, skipped: tick.skipped });
      if (activeTurnRunning && attempt < attempts) {
        await waitForLiveAgentSchedulerIdle(`${reason}-active-turn-${attempt}`);
      }
    }
    throw new Error(`${reason} did not reach ${TEST_AGENT_ID}\n${JSON.stringify(misses, null, 2)}`);
  };

  const { tick: injectedTick, action: injectedAction } = await runTargetAgentTick('8587-failure-injection', (action) => Boolean(action?.activeGoal?.id));
  assert(injectedTick?.ok === true, 'failure-injection tick failed', injectedTick);
  assert(injectedAction?.actionId, 'failure-injection tick did not create an action', injectedTick);
  assert(injectedAction?.activeGoal?.id, 'injected turn should record active goal', injectedAction);
  assert(Array.isArray(injectedAction?.candidateActionsConsidered) && injectedAction.candidateActionsConsidered.length > 0, 'injected turn should record candidate actions considered', injectedAction);
  assert(injectedAction?.selectedPlanStep?.id, 'injected turn should record selected plan step', injectedAction);
  assert(injectedAction?.finalActionDecision?.selectedActionId, 'injected turn should record final action decision', injectedAction);

  const { tick: recoveryTick, action: recoveryAction } = await runTargetAgentTick('8587-failure-replan', (action) => action?.activeGoal?.kind === 'replan');
  assert(recoveryTick?.ok === true, 'failure recovery tick failed', recoveryTick);
  assert(recoveryAction?.actionId, 'failure recovery tick did not create a replacement action', recoveryTick);
  assert(recoveryAction.planId && recoveryAction.planId !== injectedAction.planId, 'failure recovery should use a replacement plan', { injectedAction, recoveryAction });
  assert(recoveryAction.loopActionId && recoveryAction.loopActionId !== injectedAction.loopActionId, 'failure recovery should select a replacement action', { injectedAction, recoveryAction });
  assert(recoveryAction?.activeGoal?.kind === 'replan', 'recovery turn should record the replan goal', recoveryAction);
  assert(recoveryAction?.selectedPlanStep?.id, 'recovery turn should record selected plan step', recoveryAction);
  assert(recoveryAction?.finalActionDecision?.selectedActionId === recoveryAction.loopActionId, 'recovery turn final decision should match replacement action', recoveryAction);

  const status = await fetchJson('/api/agent-live-loop');
  const agentState = status?.state?.agents?.[TEST_AGENT_ID] || {};
  assert(agentState.lastFailedExpectation?.recoveryActionId === recoveryAction.actionId, 'status refresh should mark the mismatch as recovered', agentState.lastFailedExpectation);

  const metrics = await fetchJson('/api/live-agent-mode/metrics');
  assert(metrics.metrics?.failedExpectationCount >= 1, 'metrics should count failed expectations', metrics.metrics);
  assert(metrics.metrics?.replanCount >= 1, 'metrics should count replans', metrics.metrics);
  assert(metrics.metrics?.successfulRecoveryCount >= 1, 'metrics should count successful recoveries', metrics.metrics);
  assert(metrics.metrics?.outcomeAwareness?.expectedOutcomeCount >= 2, 'metrics should record expected outcomes for created backend actions', metrics.metrics?.outcomeAwareness);
  assert(metrics.metrics?.outcomeAwareness?.observedOutcomeCount >= 1, 'metrics should record observed outcomes for settled backend actions', metrics.metrics?.outcomeAwareness);
  assert(metrics.metrics?.outcomeAwareness?.mismatchCount >= 1, 'metrics should record expected-vs-observed mismatches', metrics.metrics?.outcomeAwareness);
  assert(metrics.metrics?.outcomeAwareness?.recoveryCount >= 1, 'metrics should record outcome recovery count', metrics.metrics?.outcomeAwareness);
  assert(metrics.metrics?.outcomeAwareness?.unresolvedMismatchCount === 0, 'recovered mismatch should not remain unresolved', metrics.metrics?.outcomeAwareness);
  assert(typeof metrics.metrics?.expectedObservedSuccessRate === 'number', 'metrics should report expected-vs-observed success rate', metrics.metrics);
  assert(metrics.metrics?.planner?.turnsWithPlanningRecordCount >= 2, 'metrics should count turn planning records', metrics.metrics?.planner);
  assert(metrics.metrics?.planner?.bounds?.maxActionsPerTick === 1, 'metrics should report max actions per tick bound', metrics.metrics?.planner);
  assert(metrics.metrics?.planner?.bounds?.maxToolCallsPerTurn === 1, 'metrics should report max tool calls per turn bound', metrics.metrics?.planner);
  assert(metrics.metrics?.planner?.bounds?.perAgentCooldownEnforced === true, 'metrics should report per-agent cooldown enforcement', metrics.metrics?.planner);

  console.log(`PASS: failure injection mismatch ${injectedAction.actionId}/${injectedAction.loopActionId} replanned to ${recoveryAction.actionId}/${recoveryAction.loopActionId}.`);
  return { injectedAction, recoveryAction, metrics };
}

async function enableLoopForFinalMetrics() {
  const enabled = await postJson('/api/agent-live-loop', {
    enabled: true,
    clearPause: true,
    clearKillSwitch: true,
    actor: '8587-acceptance-final-metrics',
  });
  assert(enabled?.ok === true && enabled.state?.enabled === true, 'failed to re-enable loop for final metrics', enabled);
  return enabled;
}

function verifyMultiAgentSocialMetrics(metrics) {
  assert(metrics.loop?.enabledAgentCount >= 2, 'metrics should include at least two enabled live agents', metrics.loop);
  assert(metrics.metrics?.relationshipCount >= 1, 'metrics should report at least one relationship', metrics.metrics);
  assert(metrics.metrics?.socialObservationCount >= 1, 'metrics should report social observations', metrics.metrics);
  assert(metrics.metrics?.groupGoalCount >= 1, 'metrics should report group/shared goals', metrics.metrics);
  assert(metrics.metrics?.conversationTriggerCount >= 1, 'metrics should report conversation triggers', metrics.metrics);
  assert(metrics.metrics?.society?.roleCount >= 2, 'society metrics should include at least two role records', metrics.metrics?.society);
  assert(metrics.metrics?.society?.liveEnabledRoleCount >= 2, 'society metrics should include two enabled live-agent roles', metrics.metrics?.society);
  assert(metrics.metrics?.society?.normConstraintCount >= 1, 'society metrics should include norms/constraints', metrics.metrics?.society);
  assert(metrics.checklist?.societyRolesPresent === true, 'metrics checklist should confirm society roles', metrics.checklist);
  assert(metrics.checklist?.socialObservationsCreated === true, 'metrics checklist should confirm social observations', metrics.checklist);
  assert(metrics.checklist?.groupGoalsUpdated === true, 'metrics checklist should confirm group goals', metrics.checklist);
  assert(metrics.checklist?.conversationTriggersCreated === true, 'metrics checklist should confirm conversation triggers', metrics.checklist);
  assert(metrics.checklist?.societyStateUpdated === true, 'metrics checklist should confirm society state updates', metrics.checklist);
  console.log(`PASS: multi-agent social metrics ${JSON.stringify({
    enabledAgentCount: metrics.loop.enabledAgentCount,
    relationshipCount: metrics.metrics.relationshipCount,
    socialObservationCount: metrics.metrics.socialObservationCount,
    groupGoalCount: metrics.metrics.groupGoalCount,
    conversationTriggerCount: metrics.metrics.conversationTriggerCount,
    society: metrics.metrics.society,
  })}`);
}

function verifySoakDistributionMetrics(metrics, { expectedAgents, expectedTurns }) {
  const distribution = metrics.metrics?.perAgentDistribution;
  assert(distribution?.schemaVersion === 'agent-live-mode-per-agent-distribution/v1', 'metrics should expose per-agent turn/action distribution', distribution);
  assert(Array.isArray(distribution.agents), 'per-agent distribution should include agent rows', distribution);
  assert(distribution.enabledAgentCount >= expectedAgents, `per-agent distribution should include at least ${expectedAgents} enabled agents`, distribution);
  assert(distribution.enabledCompletedTurnAgentCount >= expectedAgents, `soak turns should complete across at least ${expectedAgents} enabled live agents`, distribution);
  assert(distribution.enabledCompletedBackendActionAgentCount >= expectedAgents, `soak backend actions should complete across at least ${expectedAgents} enabled live agents`, distribution);
  assert(distribution.allEnabledAgentsHaveCompletedTurn === true, 'all enabled soak agents should have at least one completed turn', distribution);
  assert(distribution.allEnabledAgentsHaveCompletedBackendAction === true, 'all enabled soak agents should have at least one completed backend action', distribution);

  const rowsByAgent = distribution.byAgent || Object.fromEntries(distribution.agents.map((row) => [row.agentId, row]));
  const expectedSoakAgents = SOAK_AGENT_IDS.slice(0, expectedAgents);
  for (const agentId of expectedSoakAgents) {
    const row = rowsByAgent[agentId];
    assert(row?.liveModeEnabled === true, `per-agent distribution missing enabled soak agent ${agentId}`, { agentId, distribution });
    assert(Number(row.completedTurnCount || 0) > 0, `soak agent ${agentId} has no completed turns`, row);
    assert(Number(row.completedBackendActionCount || 0) > 0, `soak agent ${agentId} has no completed backend actions`, row);
  }

  const distributedCompletedTurnCount = Object.values(rowsByAgent).reduce((sum, row) => sum + Number(row?.completedTurnCount || 0), 0);
  const distributedCompletedActionCount = Object.values(rowsByAgent).reduce((sum, row) => sum + Number(row?.completedBackendActionCount || 0), 0);
  assert(distributedCompletedTurnCount >= expectedTurns, `per-agent completed turn total should cover at least ${expectedTurns} turns`, { distributedCompletedTurnCount, distribution });
  assert(distributedCompletedActionCount >= expectedTurns, `per-agent completed action total should cover at least ${expectedTurns} backend actions`, { distributedCompletedActionCount, distribution });
  assert(metrics.finalGate?.checks?.defaultSoakEnabledAgentRosterPresent === true, 'final gate should check the default enabled soak roster size', metrics.finalGate);
  assert(metrics.finalGate?.checks?.defaultSoakCompletedTurnTargetMet === true, 'final gate should check the default completed-turn soak target', metrics.finalGate);
  assert(metrics.finalGate?.checks?.defaultSoakCompletedBackendActionTargetMet === true, 'final gate should check the default backend-action soak target', metrics.finalGate);
  assert(metrics.finalGate?.checks?.turnsCompletedAcrossEnabledAgents === true, 'final gate should check enabled-agent turn distribution', metrics.finalGate);
  assert(metrics.finalGate?.checks?.actionsCompletedAcrossEnabledAgents === true, 'final gate should check enabled-agent action distribution', metrics.finalGate);
  assert(metrics.finalGate?.evidence?.enabledCompletedTurnAgentCount >= expectedAgents, 'final gate should report turn distribution evidence', metrics.finalGate);
  assert(metrics.finalGate?.evidence?.enabledCompletedBackendActionAgentCount >= expectedAgents, 'final gate should report action distribution evidence', metrics.finalGate);
  const evidenceRows = metrics.finalGate?.evidence?.enabledAgents || [];
  assert(evidenceRows.length >= expectedAgents, 'final gate should include compact enabled-agent distribution rows', metrics.finalGate?.evidence);

  const compactRows = Object.fromEntries(expectedSoakAgents.map((agentId) => {
    const row = rowsByAgent[agentId] || {};
    const evidenceRow = evidenceRows.find((candidate) => candidate?.agentId === agentId);
    assert(Number(evidenceRow?.completedTurnCount || 0) === Number(row.completedTurnCount || 0), `final gate turn evidence does not match per-agent row for ${agentId}`, { row, evidenceRow });
    assert(Number(evidenceRow?.completedBackendActionCount || 0) === Number(row.completedBackendActionCount || 0), `final gate action evidence does not match per-agent row for ${agentId}`, { row, evidenceRow });
    return [agentId, {
      completedTurnCount: row.completedTurnCount || 0,
      completedBackendActionCount: row.completedBackendActionCount || 0,
      completedActionTypes: row.completedActionTypes || [],
    }];
  }));
  console.log(`PASS: soak distribution metrics ${JSON.stringify({
    enabledAgentCount: distribution.enabledAgentCount,
    enabledCompletedTurnAgentCount: distribution.enabledCompletedTurnAgentCount,
    enabledCompletedBackendActionAgentCount: distribution.enabledCompletedBackendActionAgentCount,
    expectedSoakAgents,
    agents: compactRows,
    finalGateEvidence: metrics.finalGate.evidence,
  })}`);
}

async function verifyAutonomyMetrics({ expectedTurns, expectedAgents }) {
  const metrics = await fetchJson('/api/live-agent-mode/metrics');
  assert(metrics?.ok === true, 'Live Agent metrics endpoint failed', metrics);
  assert(metrics.loop?.enabledAgentCount >= expectedAgents, `metrics should include at least ${expectedAgents} enabled live agents`, metrics.loop);
  assert(metrics.metrics?.completedTurnCount >= expectedTurns, `metrics should show at least ${expectedTurns} completed turns`, metrics.metrics);
  assert(metrics.metrics?.completedBackendActionCount >= expectedTurns, `metrics should show at least ${expectedTurns} backend-owned completed actions`, metrics.metrics);
  assert(metrics.metrics?.presencePersistence?.agentCount >= expectedAgents, 'metrics should expose presence persistence agent count', metrics.metrics?.presencePersistence);
  assert(metrics.metrics?.presencePersistence?.persistedLocationCount >= expectedAgents, 'metrics should expose persisted server-authoritative locations', metrics.metrics?.presencePersistence);
  assert(metrics.metrics?.presencePersistence?.refreshResetCount === 0, 'metrics should show no refresh resets', metrics.metrics?.presencePersistence);
  assert(metrics.metrics?.presencePersistence?.ok === true, 'metrics should report passing presence persistence', metrics.metrics?.presencePersistence);
  verifySoakDistributionMetrics(metrics, { expectedAgents, expectedTurns });
  assert(metrics.metrics?.routePendingActiveCount === 0, 'metrics should show no active route_pending actions', metrics.metrics);
  assert(metrics.metrics?.memoryCaps?.withinCaps === true, 'metrics should show live-agent memory stayed within bounded caps', metrics.metrics?.memoryCaps);
  assert(metrics.metrics?.memoryCaps?.breachCount === 0, 'metrics should show no memory cap breaches', metrics.metrics?.memoryCaps);
  assert(metrics.metrics?.memoryGrowth?.bounded === true, 'metrics should expose bounded memory growth', metrics.metrics?.memoryGrowth);
  assert(metrics.metrics?.memoryGrowth?.maxRetainedToCapRatio <= 1, 'metrics should show retained memory stayed within growth caps', metrics.metrics?.memoryGrowth);
  assert(typeof metrics.metrics?.turnDuration?.p50Ms === 'number', 'metrics should expose p50 turn duration', metrics.metrics?.turnDuration);
  assert(typeof metrics.metrics?.turnDuration?.p95Ms === 'number', 'metrics should expose p95 turn duration', metrics.metrics?.turnDuration);
  assert(typeof metrics.metrics?.actionSuccessRate === 'number' && metrics.metrics.actionSuccessRate >= 0.99, 'metrics should expose a passing action success rate', metrics.metrics);
  assert(typeof metrics.metrics?.recoveryRate === 'number' && metrics.metrics.recoveryRate >= 1, 'metrics should expose a passing recovery rate', metrics.metrics);
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
  verifyMultiAgentSocialMetrics(metrics);
  assert(typeof metrics.metrics?.planCount === 'number' && metrics.metrics.planCount > 0, 'metrics should report plan count', metrics.metrics);
  assert(typeof metrics.metrics?.replanCount === 'number' && metrics.metrics.replanCount >= 1, 'metrics should report replan count', metrics.metrics);
  assert(typeof metrics.metrics?.failedExpectationCount === 'number' && metrics.metrics.failedExpectationCount >= 1, 'metrics should report failed expectation count', metrics.metrics);
  assert(typeof metrics.metrics?.successfulRecoveryCount === 'number' && metrics.metrics.successfulRecoveryCount >= 1, 'metrics should report successful recovery count', metrics.metrics);
  assert(typeof metrics.metrics?.expectedObservedSuccessRate === 'number', 'metrics should report expected-vs-observed success rate', metrics.metrics);
  assert(typeof metrics.metrics?.recoveryCount === 'number' && metrics.metrics.recoveryCount >= 1, 'metrics should report recovery count', metrics.metrics);
  assert(typeof metrics.metrics?.unresolvedMismatchCount === 'number', 'metrics should report unresolved mismatch count', metrics.metrics);
  assert(typeof metrics.metrics?.escalationCount === 'number', 'metrics should report escalation count', metrics.metrics);
  assert(metrics.checklist?.outcomeAwarenessRecordsPresent === true, 'metrics checklist should confirm outcome awareness records', metrics.checklist);
  assert(metrics.metrics?.planner?.bounds?.maxActionsPerTick >= 1, 'planner metrics should report max actions per tick bound', metrics.metrics?.planner);
  assert(metrics.metrics?.planner?.bounds?.maxToolCallsPerTurn >= 1, 'planner metrics should report max tool calls per turn bound', metrics.metrics?.planner);
  assert(metrics.metrics?.planner?.bounds?.perAgentCooldownEnforced === true, 'planner metrics should report per-agent cooldown enforcement', metrics.metrics?.planner);
  assert(metrics.checklist?.relationshipsUpdated === true, 'metrics checklist should confirm relationship updates', metrics.checklist);
  assert(metrics.checklist?.providerAdapterReadiness === true, 'metrics checklist should confirm provider adapter readiness', metrics.checklist);
  assert(metrics.checklist?.clawMindModuleContractsReady === true, 'metrics checklist should confirm ClawMind module contracts', metrics.checklist);
  assert(metrics.checklist?.lightweightMetricsOptimized === true, 'metrics checklist should confirm lightweight metrics optimization', metrics.checklist);
  assert(metrics.providerSupport?.schemaVersion === 'agent-live-mode-provider-adapter-contract/v1', 'provider support metrics should use the adapter contract schema', metrics.providerSupport);
  assert(metrics.providerSupport?.bridgeSchemaVersion === 'agent-live-mode-provider-bridge/v1', 'provider support metrics should expose the bridge schema', metrics.providerSupport);
  assert(metrics.providerSupport?.providerKindCount >= 3, 'provider support metrics should include mixed provider kinds', metrics.providerSupport);
  assert(metrics.providerSupport?.providerKinds?.fake, 'provider support metrics should include the fake provider fixture', metrics.providerSupport);
  assert(metrics.providerSupport?.providerKinds?.hermes || metrics.providerSupport?.providerKinds?.codex, 'provider support metrics should include at least one non-OpenClaw provider fixture', metrics.providerSupport);
  assert(metrics.providerSupport?.bridgeMetrics?.decisionCalls >= 1, 'provider bridge metrics should count decision calls', metrics.providerSupport?.bridgeMetrics);
  assert(typeof metrics.providerSupport?.bridgeMetrics?.timeouts === 'number', 'provider bridge metrics should report timeout count', metrics.providerSupport?.bridgeMetrics);
  assert(typeof metrics.providerSupport?.bridgeMetrics?.fallbacks === 'number', 'provider bridge metrics should report fallback count', metrics.providerSupport?.bridgeMetrics);
  assert(metrics.providerSupport?.providerKinds?.fake?.bridge?.stats?.proposeCalls >= 1, 'provider bridge metrics should count fake provider proposal calls', metrics.providerSupport?.providerKinds?.fake?.bridge);
  assert(metrics.providerSupport?.capabilityGapsByProvider?.fake && Array.isArray(metrics.providerSupport.capabilityGapsByProvider.fake), 'provider support metrics should report per-provider capability gaps', metrics.providerSupport?.capabilityGapsByProvider);
  assert(metrics.providerSupport?.optimization?.providerCallsDuringMetrics === 0, 'provider support metrics must not call providers', metrics.providerSupport?.optimization);
  assert(metrics.providerSupport?.optimization?.modelCallsDuringMetrics === 0, 'provider support metrics must not call models', metrics.providerSupport?.optimization);
  assert(metrics.providerModelCallCounts?.metricsReadOnlyBudgetOk === true, 'provider/model budget metrics should stay read-only', metrics.providerModelCallCounts);
  assert(typeof metrics.providerModelCallCounts?.providerBridgeCalls === 'number', 'provider/model metrics should expose provider bridge call counts', metrics.providerModelCallCounts);
  assert(typeof metrics.providerModelCallCounts?.modelCallsDuringMetrics === 'number', 'provider/model metrics should expose model call counts', metrics.providerModelCallCounts);
  assert(metrics.clawMindArchitecture?.schemaVersion === 'agent-live-mode-clawmind-architecture/v1', 'ClawMind metrics should use the architecture schema', metrics.clawMindArchitecture);
  assert(metrics.clawMindArchitecture?.checklist?.allModuleContractsReady === true, 'ClawMind metrics should confirm all module contracts', metrics.clawMindArchitecture);
  assert(metrics.clawMindArchitecture?.checklist?.allModulesExecuted === true, 'ClawMind metrics should confirm all modules executed', metrics.clawMindArchitecture);
  for (const [moduleName, moduleMetrics] of Object.entries(metrics.clawMindArchitecture?.modules || {})) {
    assert(moduleMetrics?.runtimeEvidence === true, `ClawMind module ${moduleName} should have runtime evidence`, moduleMetrics);
    assert(Number(moduleMetrics?.executionCount || 0) > 0, `ClawMind module ${moduleName} should report execution count`, moduleMetrics);
    assert(moduleMetrics?.lastExecutionAt, `ClawMind module ${moduleName} should report last execution time`, moduleMetrics);
    assert(typeof moduleMetrics?.lastLatencyMs === 'number', `ClawMind module ${moduleName} should report latency`, moduleMetrics);
    assert(typeof moduleMetrics?.latency?.p50Ms === 'number', `ClawMind module ${moduleName} should report p50 latency`, moduleMetrics);
    assert(typeof moduleMetrics?.latency?.p95Ms === 'number', `ClawMind module ${moduleName} should report p95 latency`, moduleMetrics);
  }
  assert(metrics.clawMindArchitecture?.optimization?.heavyWorldScan === false, 'ClawMind metrics must stay lightweight', metrics.clawMindArchitecture?.optimization);
  assert(metrics.finalGate?.ok === true, 'final soak gate should pass', metrics.finalGate);
  assert(metrics.finalGate?.checks?.noRoutePendingActions === true, 'final gate should fail on route-pending actions', metrics.finalGate);
  assert(metrics.finalGate?.checks?.noUnresolvedMismatches === true, 'final gate should fail on unresolved mismatches', metrics.finalGate);
  assert(metrics.finalGate?.checks?.memoryWithinCaps === true, 'final gate should fail on memory cap breaches', metrics.finalGate);
  assert(metrics.finalGate?.checks?.memoryGrowthBounded === true, 'final gate should fail on unbounded memory growth', metrics.finalGate);
  assert(metrics.finalGate?.checks?.featureGateOpen === true && metrics.finalGate?.checks?.configGateOpen === true, 'final gate should fail on disabled feature gates', metrics.finalGate);
  assert(metrics.finalGate?.checks?.providerModelBudgetOk === true, 'final gate should fail on provider/model budget violations', metrics.finalGate);
  assert(metrics.finalGate?.checks?.presencePersistenceOk === true, 'final gate should fail on presence persistence resets', metrics.finalGate);
  console.log(`PASS: autonomy metrics ${JSON.stringify({
    enabledAgentCount: metrics.loop.enabledAgentCount,
    completedTurnCount: metrics.metrics.completedTurnCount,
    completedBackendActionCount: metrics.metrics.completedBackendActionCount,
    completedBackendActionCountByAgent: metrics.metrics.completedBackendActionCountByAgent,
    perAgentDistribution: metrics.finalGate.evidence,
    turnDuration: metrics.metrics.turnDuration,
    actionSuccessRate: metrics.metrics.actionSuccessRate,
    recoveryRate: metrics.metrics.recoveryRate,
    typedObjectActionTypes: metrics.metrics.typedObjectActionTypes,
    inWorldCommunicationCount: metrics.metrics.inWorldCommunicationCount,
    reactionOpportunityCount: metrics.metrics.reactionOpportunityCount,
    relationshipCount: metrics.metrics.relationshipCount,
    socialObservationCount: metrics.metrics.socialObservationCount,
    groupGoalCount: metrics.metrics.groupGoalCount,
    conversationTriggerCount: metrics.metrics.conversationTriggerCount,
    societyRoleCount: metrics.metrics.societyRoleCount,
    memory: metrics.metrics.memory,
    presencePersistence: metrics.metrics.presencePersistence,
    memoryGrowth: metrics.metrics.memoryGrowth,
    planner: {
      planCount: metrics.metrics.planCount,
      replanCount: metrics.metrics.replanCount,
      failedExpectationCount: metrics.metrics.failedExpectationCount,
      successfulRecoveryCount: metrics.metrics.successfulRecoveryCount,
    },
    providerKindCount: metrics.providerSupport.providerKindCount,
    providerModelCallCounts: metrics.providerModelCallCounts,
    clawMindContractGaps: metrics.clawMindArchitecture.contractGaps,
    clawMindRuntimeEvidenceGaps: metrics.clawMindArchitecture.runtimeEvidenceGaps,
    finalGate: metrics.finalGate,
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
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

base_url = os.environ["VW_ACCEPTANCE_BASE_URL"]
action_id = os.environ["VW_ACCEPTANCE_ACTION_ID"]

def install_page_diagnostics(page):
    console_messages = []
    page_errors = []
    page.on("console", lambda msg: console_messages.append(f"{msg.type}: {msg.text}") if len(console_messages) < 80 else None)
    page.on("pageerror", lambda exc: page_errors.append(str(exc)) if len(page_errors) < 20 else None)
    return console_messages, page_errors

def wait_for_product_canvas(page, console_messages, page_errors, label):
    try:
        page.wait_for_selector("#pixiContainer canvas", state="attached", timeout=90000)
        return
    except PlaywrightTimeoutError as exc:
        diagnostics = page.evaluate("""
() => {
  const pixi = document.querySelector('#pixiContainer');
  return {
    url: window.location.href,
    bootStage: window.__vwBootStage || null,
    bodyText: (document.body?.innerText || '').slice(0, 2000),
    canvasCount: document.querySelectorAll('canvas').length,
    pixiExists: Boolean(pixi),
    pixiHtml: pixi ? pixi.innerHTML.slice(0, 1000) : null,
    scripts: Array.from(document.scripts || []).map(script => script.src || script.textContent?.slice(0, 80) || '').slice(-20),
  };
}
""")
        diagnostics["console"] = console_messages[-40:]
        diagnostics["pageErrors"] = page_errors[-20:]
        raise AssertionError(json.dumps({"label": label, "diagnostics": diagnostics}, sort_keys=True)) from exc

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=[
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--ignore-gpu-blocklist",
        "--enable-webgl",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
    ])
    page = browser.new_page(viewport={"width": 960, "height": 640}, device_scale_factor=1)
    console_messages, page_errors = install_page_diagnostics(page)
    page.goto(base_url, wait_until="domcontentloaded", timeout=30000)
    wait_for_product_canvas(page, console_messages, page_errors, "browser-replay-render")
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

async function runTwoClientWorldEventFeedSyncCheck() {
  const script = String.raw`
import json
import os
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

base_url = os.environ["VW_ACCEPTANCE_BASE_URL"]
agent_id = os.environ["VW_ACCEPTANCE_AGENT_ID"]
home_building_id = os.environ["VW_ACCEPTANCE_HOME_BUILDING_ID"]
sync_building_id = "8587-two-client-feed-building"
sync_object_id = "8587-two-client-feed-object"

def install_page_diagnostics(page):
    console_messages = []
    page_errors = []
    page.on("console", lambda msg: console_messages.append(f"{msg.type}: {msg.text}") if len(console_messages) < 80 else None)
    page.on("pageerror", lambda exc: page_errors.append(str(exc)) if len(page_errors) < 20 else None)
    return console_messages, page_errors

def wait_for_product_canvas(page, console_messages, page_errors, label):
    try:
        page.wait_for_selector("#pixiContainer canvas", state="attached", timeout=90000)
        return
    except PlaywrightTimeoutError as exc:
        diagnostics = page.evaluate("""
() => {
  const pixi = document.querySelector('#pixiContainer');
  return {
    url: window.location.href,
    bootStage: window.__vwBootStage || null,
    bodyText: (document.body?.innerText || '').slice(0, 2000),
    canvasCount: document.querySelectorAll('canvas').length,
    pixiExists: Boolean(pixi),
    pixiHtml: pixi ? pixi.innerHTML.slice(0, 1000) : null,
    scripts: Array.from(document.scripts || []).map(script => script.src || script.textContent?.slice(0, 80) || '').slice(-20),
  };
}
""")
        diagnostics["console"] = console_messages[-40:]
        diagnostics["pageErrors"] = page_errors[-20:]
        raise AssertionError(json.dumps({"label": label, "diagnostics": diagnostics}, sort_keys=True)) from exc

def wait_for_world_event_client(page, label):
    page.wait_for_function("""
() => typeof window.__VWSyncLiveAgentModeWorldEvents === 'function'
  && window.__VWLiveAgentModeWorldEventFeedState
  && window.buildings instanceof Map
  && Array.isArray(window.agents)
""", timeout=60000)
    result = page.evaluate("() => window.__VWSyncLiveAgentModeWorldEvents({ force: true, snapshot: true, limit: 200 })")
    if not result:
        raise AssertionError(f"{label} could not run initial world-event sync")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=[
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--ignore-gpu-blocklist",
        "--enable-webgl",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
    ])
    page_a = browser.new_page(viewport={"width": 960, "height": 640}, device_scale_factor=1)
    page_b = browser.new_page(viewport={"width": 960, "height": 640}, device_scale_factor=1)
    diagnostics = []
    for label, page in (("client-a", page_a), ("client-b", page_b)):
        console_messages, page_errors = install_page_diagnostics(page)
        diagnostics.append((label, page, console_messages, page_errors))
        page.goto(base_url, wait_until="domcontentloaded", timeout=30000)
        wait_for_product_canvas(page, console_messages, page_errors, label)
        wait_for_world_event_client(page, label)

    movement = page_a.evaluate("""
async ({ agentId, homeBuildingId }) => {
  const payload = {
    source: '8587-two-client-world-event-feed',
    state: 'arrived',
    location: {
      agentId,
      buildingId: homeBuildingId,
      floor: 1,
      apiX: -360,
      apiZ: -180,
      x: -9,
      z: -4.5,
      updatedAt: new Date().toISOString(),
    },
  };
  const response = await fetch('/api/agent-presence/' + encodeURIComponent(agentId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error('presence mutation failed: ' + JSON.stringify(result));
  return result.presence;
}
""", {"agentId": agent_id, "homeBuildingId": home_building_id})

    movement_seen = page_b.evaluate("""
async ({ agentId, expectedX, expectedY }) => {
  let last = null;
  for (let attempt = 0; attempt < 36; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const agent = (window.agents || []).find(candidate => String(candidate?.id || candidate?.statusKey || '') === agentId) || null;
    const dx = Math.abs(Number(agent?.x) - expectedX);
    const dy = Math.abs(Number(agent?.y) - expectedY);
    const feed = window.__VWLiveAgentModeWorldEventFeedState || {};
    last = { ok: Boolean(agent && dx <= 0.01 && dy <= 0.01), agent: agent ? { x: agent.x, y: agent.y, source: agent._serverPresence?.source || null } : null, delta: { dx, dy }, feed };
    if (last.ok) return last;
  }
  throw new Error('second client did not receive movement patch: ' + JSON.stringify(last));
}
""", {"agentId": agent_id, "expectedX": -360, "expectedY": -180})

    building = {
      "id": sync_building_id,
      "name": "8587 Two Client Feed",
      "type": "office",
      "worldX": 34,
      "worldY": -14,
      "x": 34,
      "z": -14,
      "widthTiles": 8,
      "heightTiles": 7,
      "width": 8,
      "depth": 7,
      "interior": {"furniture": [], "walls": []},
    }
    page_a.evaluate("""
async ({ building }) => {
  const response = await fetch('/api/building', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(building),
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error('building create failed: ' + JSON.stringify(result));
}
""", {"building": building})

    create_seen = page_b.evaluate("""
async ({ buildingId }) => {
  let last = null;
  for (let attempt = 0; attempt < 36; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const building = window.buildings?.get?.(buildingId);
    last = { ok: Boolean(building), buildingName: building?.name || null, feed: window.__VWLiveAgentModeWorldEventFeedState || {} };
    if (last.ok) return last;
  }
  throw new Error('second client did not receive building create patch: ' + JSON.stringify(last));
}
""", {"buildingId": sync_building_id})

    updated_building = dict(building)
    updated_building["interior"] = {
        "furniture": [{
            "id": sync_object_id,
            "objectInstanceId": sync_object_id,
            "type": "whiteboard",
            "catalogId": "whiteboard",
            "x": 3,
            "z": 3,
            "floor": 1,
            "buildingFloor": 1,
            "capabilityTags": ["planning.brainstorm"],
        }],
        "walls": [],
    }
    page_a.evaluate("""
async ({ building }) => {
  const response = await fetch('/api/building/' + encodeURIComponent(building.id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(building),
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error('building update failed: ' + JSON.stringify(result));
}
""", {"building": updated_building})

    update_seen = page_b.evaluate("""
async ({ buildingId, objectId }) => {
  let last = null;
  for (let attempt = 0; attempt < 36; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const building = window.buildings?.get?.(buildingId);
    const furniture = building?.interior?.furniture || [];
    const object = furniture.find(item => String(item?.objectInstanceId || item?.id || '') === objectId) || null;
    last = { ok: Boolean(object), object: object ? { id: object.id, type: object.type, catalogId: object.catalogId } : null, feed: window.__VWLiveAgentModeWorldEventFeedState || {} };
    if (last.ok) return last;
  }
  throw new Error('second client did not receive object create/update patch: ' + JSON.stringify(last));
}
""", {"buildingId": sync_building_id, "objectId": sync_object_id})

    page_a.evaluate("""
async ({ buildingId }) => {
  const response = await fetch('/api/building/' + encodeURIComponent(buildingId), { method: 'DELETE' });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error('building delete failed: ' + JSON.stringify(result));
}
""", {"buildingId": sync_building_id})

    delete_seen = page_b.evaluate("""
async ({ buildingId }) => {
  let last = null;
  for (let attempt = 0; attempt < 36; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const exists = window.buildings?.has?.(buildingId);
    last = { ok: exists === false, exists, feed: window.__VWLiveAgentModeWorldEventFeedState || {} };
    if (last.ok) return last;
  }
  throw new Error('second client did not receive building delete patch: ' + JSON.stringify(last));
}
""", {"buildingId": sync_building_id})

    metrics = page_b.evaluate("""
async () => {
  const response = await fetch('/api/live-agent-mode/metrics', { cache: 'no-store' });
  const metrics = await response.json();
  return metrics.metrics?.worldEventFeed || null;
}
""")
    browser.close()

if not metrics or metrics.get("ok") is not True:
    raise AssertionError(json.dumps({"metrics": metrics}, sort_keys=True))
if int(metrics.get("connectedClientCount") or 0) < 2:
    raise AssertionError(json.dumps({"reason": "connected client count below two", "metrics": metrics}, sort_keys=True))
if int(metrics.get("replayableEventCount") or 0) < 4:
    raise AssertionError(json.dumps({"reason": "world event replay count too low", "metrics": metrics}, sort_keys=True))

print(json.dumps({
    "ok": True,
    "movement": movement,
    "movementSeen": movement_seen,
    "createSeen": create_seen,
    "updateSeen": update_seen,
    "deleteSeen": delete_seen,
    "metrics": metrics,
}, sort_keys=True))
`;
  const { stdout } = await runChild('python3', ['-'], {
    input: script,
    env: {
      VW_ACCEPTANCE_BASE_URL: BASE_URL,
      VW_ACCEPTANCE_AGENT_ID: TEST_AGENT_ID,
      VW_ACCEPTANCE_HOME_BUILDING_ID: HOME_BUILDING_ID,
    },
  });
  const result = JSON.parse(stdout.trim().split('\n').at(-1));
  assert(result.ok === true, 'two-client world event feed sync check failed', result);
  assert(result.metrics?.connectedClientCount >= 2, 'world event metrics did not record two connected clients', result.metrics);
  assert(result.metrics?.ok === true, 'world event metrics did not report ok=true', result.metrics);
  console.log(`PASS: two 8587 browser clients synced movement plus building/object create-update-delete via ${result.metrics.replayableEventCount} replayable world events (p95 ${result.metrics.p95MultiClientSyncLatencyMs}ms).`);
  return result;
}

async function runBrowserRefreshPresenceCheck() {
  const script = String.raw`
import json
import os
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

base_url = os.environ["VW_ACCEPTANCE_BASE_URL"]
agent_id = os.environ["VW_ACCEPTANCE_AGENT_ID"]

def install_page_diagnostics(page):
    console_messages = []
    page_errors = []
    page.on("console", lambda msg: console_messages.append(f"{msg.type}: {msg.text}") if len(console_messages) < 80 else None)
    page.on("pageerror", lambda exc: page_errors.append(str(exc)) if len(page_errors) < 20 else None)
    return console_messages, page_errors

def wait_for_product_canvas(page, console_messages, page_errors, label):
    try:
        page.wait_for_selector("#pixiContainer canvas", state="attached", timeout=90000)
        return
    except PlaywrightTimeoutError as exc:
        diagnostics = page.evaluate("""
() => {
  const pixi = document.querySelector('#pixiContainer');
  return {
    url: window.location.href,
    bootStage: window.__vwBootStage || null,
    bodyText: (document.body?.innerText || '').slice(0, 2000),
    canvasCount: document.querySelectorAll('canvas').length,
    pixiExists: Boolean(pixi),
    pixiHtml: pixi ? pixi.innerHTML.slice(0, 1000) : null,
    scripts: Array.from(document.scripts || []).map(script => script.src || script.textContent?.slice(0, 80) || '').slice(-20),
  };
}
""")
        diagnostics["console"] = console_messages[-40:]
        diagnostics["pageErrors"] = page_errors[-20:]
        raise AssertionError(json.dumps({"label": label, "diagnostics": diagnostics}, sort_keys=True)) from exc

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=[
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--ignore-gpu-blocklist",
        "--enable-webgl",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
    ])
    page = browser.new_page(viewport={"width": 960, "height": 640}, device_scale_factor=1)
    console_messages, page_errors = install_page_diagnostics(page)
    page.goto(base_url, wait_until="domcontentloaded", timeout=30000)
    results = []
    for refresh_index in range(4):
        if refresh_index > 0:
            page.reload(wait_until="domcontentloaded", timeout=30000)
        wait_for_product_canvas(page, console_messages, page_errors, f"browser-refresh-presence-{refresh_index}")
        page.wait_for_function("() => Array.isArray(window.agents) && window.agents.length > 0", timeout=60000)
        result = page.evaluate("""
async ({ agentId, refreshIndex }) => {
  const response = await fetch('/api/live-agent-mode/presence', { cache: 'no-store' });
  const payload = await response.json();
  const presence = payload.locations?.[agentId] || payload.presence?.agentLocations?.[agentId] || null;
  const agent = (window.agents || []).find(candidate => String(candidate?.id || candidate?.statusKey || '') === agentId) || null;
  const expectedX = Number.isFinite(Number(presence?.apiX)) ? Number(presence.apiX) : Number(presence?.x) * 40;
  const expectedY = Number.isFinite(Number(presence?.apiZ)) ? Number(presence.apiZ) : Number(presence?.z) * 40;
  const actualX = Number(agent?.x);
  const actualY = Number(agent?.y);
  const dx = Math.abs(actualX - expectedX);
  const dy = Math.abs(actualY - expectedY);
  return {
    ok: Boolean(agent && presence && Number.isFinite(expectedX) && Number.isFinite(expectedY) && dx <= 0.01 && dy <= 0.01),
    refreshIndex,
    agentId,
    actual: agent ? { x: actualX, y: actualY, floor: agent._floor || null, presenceSource: agent._serverPresence?.source || agent.presence?.source || null } : null,
    expected: presence ? { apiX: expectedX, apiZ: expectedY, floor: presence.floor || null, source: presence.source || null, routeState: presence.routeState || null } : null,
    delta: { dx, dy },
    pageUrl: window.location.href,
  };
}
""", {"agentId": agent_id, "refreshIndex": refresh_index})
        results.append(result)
    browser.close()

if not all(item.get("ok") for item in results):
    raise AssertionError(json.dumps(results, sort_keys=True))
print(json.dumps({"ok": True, "refreshes": len(results) - 1, "results": results}, sort_keys=True))
`;
  const { stdout } = await runChild('python3', ['-'], {
    input: script,
    env: {
      VW_ACCEPTANCE_BASE_URL: BASE_URL,
      VW_ACCEPTANCE_AGENT_ID: TEST_AGENT_ID,
    },
  });
  const result = JSON.parse(stdout.trim().split('\n').at(-1));
  assert(result.ok === true && result.refreshes >= 3, 'browser refresh presence check failed', result);
  console.log(`PASS: ${TEST_AGENT_ID} stayed at server-authoritative presence coordinates across ${result.refreshes} browser refreshes on ${BASE_URL}.`);
  return result;
}

async function verifyServerRestartPresencePersistenceAndRouteState() {
  const before = await fetchJson('/api/live-agent-mode/presence');
  const beforeLocation = before?.locations?.[TEST_AGENT_ID] || before?.presence?.agentLocations?.[TEST_AGENT_ID];
  assert(beforeLocation, 'presence location missing before restart check', before);
  const move = await postJson(`/api/agents/${encodeURIComponent(TEST_AGENT_ID)}/move`, {
    source: {
      kind: 'user',
      requestedBy: '8587-acceptance-presence-restart',
      requestId: '8587-presence-restart-route-state',
    },
    target: {
      kind: 'world-point',
      x: -320,
      y: -240,
      coordinateSpace: 'api-pixels',
      floor: 1,
      buildingId: HOME_BUILDING_ID,
    },
  });
  assert(move?.ok === true && move?.routeStatus === 'route_pending', 'failed to persist active move intent before restart', move);

  const preRestart = await fetchJson('/api/live-agent-mode/presence');
  const preRestartLocation = preRestart?.locations?.[TEST_AGENT_ID] || preRestart?.presence?.agentLocations?.[TEST_AGENT_ID];
  assert(preRestartLocation?.routeState === 'route_pending', 'presence did not record active route_pending state before restart', preRestartLocation);

  await restartHarnessServer('presence-persistence-active-route');

  const after = await fetchJson('/api/live-agent-mode/presence');
  const afterLocation = after?.locations?.[TEST_AGENT_ID] || after?.presence?.agentLocations?.[TEST_AGENT_ID];
  assert(afterLocation?.routeState === 'route_pending', 'presence route state did not survive server restart', afterLocation);
  assert(afterLocation?.routeId === preRestartLocation?.routeId, 'presence route id changed across restart', { before: preRestartLocation, after: afterLocation });
  assert(Number(afterLocation?.apiX) === Number(preRestartLocation?.apiX) && Number(afterLocation?.apiZ) === Number(preRestartLocation?.apiZ), 'presence coordinates changed across restart', { before: preRestartLocation, after: afterLocation });

  const agents = await fetchJson('/api/agents');
  const agent = Array.isArray(agents) ? agents.find((candidate) => candidate?.id === TEST_AGENT_ID || candidate?.statusKey === TEST_AGENT_ID) : null;
  assert(agent?.presence?.routeState === 'route_pending', 'agent roster did not reload persisted presence route state after restart', agent);
  console.log(`PASS: server restart reloaded ${TEST_AGENT_ID} presence at (${afterLocation.apiX}, ${afterLocation.apiZ}) with active route ${afterLocation.routeId}.`);
  return { before: preRestartLocation, after: afterLocation };
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

let serverOutput = '';
function startHarnessServer() {
  serverOutput = '';
  const child = spawn('python3', ['-B', 'src/server/server.py'], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => appendOutput(chunk, process.stdout));
  child.stderr.on('data', (chunk) => appendOutput(chunk, process.stderr));
  return child;
}

const appendOutput = (chunk, stream) => {
  const text = chunk.toString();
  serverOutput = `${serverOutput}${text}`.slice(-8000);
  if (keepOpen) stream.write(text);
};

let server = startHarnessServer();

let cleaned = false;
const cleanup = async () => {
  if (cleaned) return;
  cleaned = true;
  await stopServer(server);
  rmSync(dataDir, { recursive: true, force: true });
};

async function restartHarnessServer(reason = 'presence-persistence-restart') {
  await stopServer(server);
  server = startHarnessServer();
  const health = await waitForHealth(server, () => serverOutput);
  assert(health.dataDir === dataDir, `${reason} restarted with the wrong dataDir`, health);
  console.log(`PASS: restarted 8587 harness server for ${reason} with persisted data at ${dataDir}.`);
  return health;
}

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
  await disableDayNightCycleFor8587();
  await runBrowserRefreshPresenceCheck();
  await runTwoClientWorldEventFeedSyncCheck();
  await verifyTypedObjectActions();
  await verifySocialCommunicationAndMemory();
  await verifyOperatorControlsStopTurns();
  await verifyFailureInjectionReplanning();
  await verifyFakeProviderBridgeContract();
  await enableLoopForFinalMetrics();
  await verifyAutonomyMetrics({ expectedTurns: ACCEPTANCE_TURN_TARGET, expectedAgents: SOAK_AGENT_COUNT });
  await runBrowserReplayRenderCheck(backendSeries.proofs[0].actionId);
  await verifyServerRestartPresencePersistenceAndRouteState();

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
