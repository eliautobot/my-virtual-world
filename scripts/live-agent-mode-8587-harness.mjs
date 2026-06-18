#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

const TEST_PORT = 8587;
const PRODUCT_PORT = 8590;
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${TEST_PORT}`;
const PRODUCT_URL = `http://${HOST}:${PRODUCT_PORT}`;
const keepOpen = process.argv.includes('--keep-open');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Usage:
  npm run verify:live-agent-mode:8587
  npm run dev:live-agent-mode:8587

The harness starts My Virtual World on ${BASE_URL} with temporary data,
checks /healthz, pins the child process to ${TEST_PORT}, and refuses
environment or argument targets that point at ${PRODUCT_URL}.`);
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

async function fetchJson(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(`${BASE_URL}${path}`, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${path} returned HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
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

assertNoProductPortTargets();
assertNoConflictingHarnessPortEnv();
await assertPortAvailable(TEST_PORT);
const productAlreadyOpen = await isTcpOpen(PRODUCT_PORT);
if (productAlreadyOpen) {
  console.log(`Product port ${PRODUCT_PORT} is already listening; the harness will leave it untouched.`);
}

const dataDir = mkdtempSync(join(tmpdir(), 'vw-live-agent-mode-8587-'));
const childEnv = {
  ...process.env,
  PYTHONDONTWRITEBYTECODE: '1',
  VW_PORT: String(TEST_PORT),
  VW_HOST_PORT: String(TEST_PORT),
  VW_PUBLIC_ORIGIN: BASE_URL,
  VW_DATA_DIR: dataDir,
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
