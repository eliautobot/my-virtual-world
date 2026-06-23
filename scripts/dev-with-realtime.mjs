#!/usr/bin/env node
// Local dev launcher for the Python app plus Colyseus realtime sidecar.
import { spawn } from 'node:child_process';

const env = {
  ...process.env,
  VW_PORT: process.env.VW_PORT || '8590',
  VW_REALTIME_PORT: process.env.VW_REALTIME_PORT || '8591',
  VW_DATA_DIR: process.env.VW_DATA_DIR || '.local-data',
  VW_REALTIME_ENABLED: process.env.VW_REALTIME_ENABLED || 'true',
  VW_REALTIME_URL: process.env.VW_REALTIME_URL || `ws://127.0.0.1:${process.env.VW_REALTIME_PORT || '8591'}`,
};

const children = [
  spawn('python3', ['src/server/server.py'], { stdio: 'inherit', env }),
  spawn(process.execPath, ['src/realtime/server.mjs'], { stdio: 'inherit', env }),
];

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 1000).unref();
}

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`dev:realtime child exited (${signal || code})`);
    shutdown(code || 1);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
