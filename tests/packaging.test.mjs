// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The official packages (docs/INSTALL.md), checked without Docker or systemd: the image, compose.yaml, .dockerignore
// and the example systemd unit. tools/install-check.mjs runs real clean installs of both.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { SERVER_SETTINGS, loadConfig } from '../server/config.js';
import { ROOT } from './helpers/server.mjs';

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
// A routing table whose default gateway is 192.0.2.1 (little-endian hex, as in /proc/net/route).
const ROUTES = 'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\n'
  + 'eth0\t00000000\t010200C0\t0003\t0\t0\t0\t00000000\t0\t0\t0\n';
// Set by the image itself; compose.yaml must not override them.
const IMAGE_SETTINGS = ['HOST', 'PORT', 'MVW_DATA', 'MVW_KEY_FILE', 'MVW_GATEWAY_IS_LOCAL'];

test('the image: node:24-slim, the user node, volumes for the data and the key, a readiness health check', () => {
  const df = read('Dockerfile');
  assert.match(df, /^FROM node:24-slim$/m);
  assert.match(df, /^USER node$/m);
  assert.match(df, /^VOLUME \["\/data", "\/keys"\]$/m);
  assert.match(df, /^HEALTHCHECK [^\n]*\\\n\s+CMD \["node", "-e", "[^\n]*\/api\/ready/m);
  assert.match(df, /^RUN npm ci --omit=dev --ignore-scripts /m);
  const env = Object.fromEntries([...df.matchAll(/^ENV ([A-Z][A-Z0-9_]*)=(\S*)$/gm)].map(m => [m[1], m[2]]));
  assert.deepEqual(Object.keys(env).sort(), ['HOST', 'MVW_DATA', 'MVW_GATEWAY_IS_LOCAL', 'MVW_KEY_FILE', 'NODE_ENV', 'PORT']);
  assert.equal(env.MVW_DATA, '/data');
  assert.equal(env.MVW_KEY_FILE, '/keys/secret.key', 'the key lies outside the data volume');
  const { cfg, errors, warnings } = loadConfig({ env, root: '/app', routeTable: ROUTES });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(cfg.host, '0.0.0.0');
  assert.deepEqual(cfg.localPeers, ['192.0.2.1']);
});

test('the image carries only the tools owners need, and they import nothing it lacks', () => {
  const df = read('Dockerfile');
  const tools = [...df.matchAll(/^COPY (tools\/\S+) /gm)].map(m => m[1]);
  assert.deepEqual(tools, ['tools/admin.mjs', 'tools/deploy/dbcopy.mjs']);
  for (const dir of ['server', 'shared', 'client']) assert.match(df, new RegExp(`^COPY ${dir} \\./${dir}$`, 'm'));
  for (const tool of tools) {
    for (const m of read(tool).matchAll(/\bfrom '(\.{1,2}\/[^']+)'|\bimport\('(\.{1,2}\/[^']+)'\)/g)) {
      const target = path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, tool)), m[1] || m[2]));
      assert.match(target, /^(server|shared)\//, `${tool} imports ${target}, which the image does not carry`);
    }
  }
});

test('.dockerignore keeps private and runtime files out of the build context', () => {
  const lines = read('.dockerignore').split('\n').map(l => l.trim());
  for (const p of ['.git', 'node_modules', 'data', 'backups', 'docs/parity', '.env', '.env.*']) assert.ok(lines.includes(p), `${p} is ignored`);
});

test('compose.yaml: the app on the loopback address only, its data and key on volumes, the proxy as a profile', () => {
  const y = read('compose.yaml');
  assert.match(y, /^      - "127\.0\.0\.1:\$\{MVW_PORT:-8570\}:8570"$/m);
  assert.match(y, /^      - data:\/data$/m);
  assert.match(y, /^      - keys:\/keys$/m);
  assert.match(y, /^    profiles: \[proxy\]$/m);
  assert.match(y, /^        ipv4_address: \$\{MVW_PROXY_IP:-10\.87\.70\.10\}$/m);
  assert.match(y, /^          ip_range: \$\{MVW_PROXY_RANGE:-10\.87\.70\.0\/29\}$/m);
  assert.match(y, /^    command: caddy reverse-proxy --from \$\{MVW_DOMAIN:-localhost\} --to app:8570$/m);
  // The settings it gives the app are server settings that the image does not set itself.
  const app = y.split(/^  proxy:$/m)[0];
  const envBlock = app.split(/^    environment:$/m)[1].split(/^    [a-z_]+:/m)[0];
  const keys = [...envBlock.matchAll(/^      ([A-Z][A-Z0-9_]*):/gm)].map(m => m[1]);
  assert.ok(keys.length >= 5, keys.join(', '));
  for (const k of keys) {
    assert.ok(SERVER_SETTINGS.includes(k), `${k} is a server setting`);
    assert.ok(!IMAGE_SETTINGS.includes(k), `${k} is set by the image`);
  }
  // Every variable it reads is documented.
  const documented = new Set([...read('.env.example').matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map(m => m[1]));
  for (const [, k] of y.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)) assert.ok(documented.has(k), `${k} (compose.yaml) is in .env.example`);
});

test('the example systemd unit: a valid configuration, this machine only, state under /var/lib, sandboxed', () => {
  const unit = read('docs/examples/my-virtual-world.service');
  const env = Object.fromEntries([...unit.matchAll(/^Environment=([A-Z][A-Z0-9_]*)=(\S*)$/gm)].map(m => [m[1], m[2]]));
  const { cfg, errors, warnings } = loadConfig({ env, root: '/opt/my-virtual-world' });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(cfg.host, '127.0.0.1');
  assert.equal(cfg.port, 8570);
  assert.equal(cfg.data, '/var/lib/my-virtual-world/data');
  assert.equal(cfg.keyEnv.MVW_KEY_FILE, '/var/lib/my-virtual-world/keys/secret.key');
  assert.equal(cfg.trustedProxies, '127.0.0.1,::1');
  const lines = unit.split('\n');
  for (const line of ['User=my-virtual-world', 'WorkingDirectory=/opt/my-virtual-world',
    'StateDirectory=my-virtual-world my-virtual-world/data my-virtual-world/keys', 'StateDirectoryMode=0700',
    'ProtectSystem=strict', 'ProtectHome=yes', 'NoNewPrivileges=yes', 'KillSignal=SIGTERM']) {
    assert.ok(lines.includes(line), line);
  }
  assert.doesNotMatch(unit, /^MemoryDenyWriteExecute=/m, 'Node\'s JIT compiler needs writable code memory');
});

test('tools/install-check.mjs refuses an unknown mode before it touches Docker', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'install-check.mjs'), 'bogus'], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^usage: node tools\/install-check\.mjs docker\|native\|all /m);
});
