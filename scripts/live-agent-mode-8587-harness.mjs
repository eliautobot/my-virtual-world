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
const OFFICE_BUILDING_ID = 'acceptance-office';
const HOME_BUILDING_ID = 'acceptance-home';
const WATER_COOLER_ID = 'acceptance-water-cooler';
const keepOpen = process.argv.includes('--keep-open');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Usage:
  npm run verify:live-agent-mode:8587
  npm run dev:live-agent-mode:8587

The harness starts My Virtual World on ${BASE_URL} with temporary data,
checks /healthz, proves a backend Live Agent Mode turn can finish without
a browser, runs a browser replay/render check against emitted animation
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

function assertPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error) => {
      reject(new Error(`port ${port} is unavailable: ${error.message}`));
    });
    server.listen(port, HOST, () => {
      server.close(resolve);
    });
  });
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
  const timeout = setTimeout(() => controller.abort(), 3000);
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

async function verifyNoBrowserBackendTurn() {
  const before = await fetchJson('/api/agent-live-loop');
  assert(before?.runtime?.worldClient?.active === false, 'expected no active browser client before backend tick', before?.runtime?.worldClient);
  assert(before?.runtime?.guardrails?.browserTabRequiredForScheduler === false, 'expected scheduler guardrail to allow no-browser progression', before?.runtime?.guardrails);

  const tick = await postJson('/api/agent-live-loop/tick', {
    reason: '8587-acceptance-no-browser',
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

  const replay = await fetchJson(`/api/live-agent-mode/animation-events?actionId=${encodeURIComponent(actionId)}&limit=20`);
  const names = new Set((replay?.events || []).map((event) => event?.name));
  for (const expected of ['agent-move-started', 'agent-arrived', 'object-use-started', 'object-use-completed', 'world-action-completed']) {
    assert(names.has(expected), `animation replay events missing ${expected}`, replay);
  }
  assert(replay?.replay?.clientRequiredForProgress === false, 'animation replay endpoint should not require a browser for progress', replay?.replay);

  console.log(`PASS: no-browser Live Agent Mode turn completed ${actionId} with ${replay.events.length} replay events.`);
  return { actionId, action: completed, events: replay.events };
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
const productAlreadyOpen = await isTcpOpen(PRODUCT_PORT);
if (productAlreadyOpen) {
  console.log(`Product port ${PRODUCT_PORT} is already listening; the harness will leave it untouched.`);
}

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

  await seedAcceptanceWorld();
  const backendProof = await verifyNoBrowserBackendTurn();
  await runBrowserReplayRenderCheck(backendProof.actionId);

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
