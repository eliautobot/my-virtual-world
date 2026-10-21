#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Clean installs of the official packages to first sign-in, following docs/INSTALL.md (CHECKLIST I14.21, X9).
//
//   docker  Builds the image from a clean export of the repository and runs compose.yaml as a throwaway Compose project
//           on test ports: the health check, the administrator account made with the setup code over http://localhost on the Docker host, the
//           unprivileged user, the volumes and the key file, a restart, a backup, and the optional HTTPS proxy.
//   native  Follows the native install in a fresh node:24-slim container, as root. A copy of the export stands in for
//           git clone, and the container has no systemd, so the unit's User=, WorkingDirectory=, StateDirectory=,
//           UMask= and Environment= are applied by hand; systemd-analyze checks the unit file on this machine.
//   all     Both.
// First, the neutrality scan reads the exported tree (with --private, also a private list).
//
// Passwords stay inside this program (native: inside the container) and are never printed. Everything the check creates
// is removed at the end, unless --keep. It uses the ports 18570, 18480 and 18443 on this machine's loopback address,
// and the Docker images node:24-slim and caddy:2 (caddy:2 is removed again if it was not there before).
//
// Usage: node tools/install-check.mjs docker|native|all [--ref <git ref>] [--private <file>] [--log <file>] [--keep]
// Exit status: 0 every check passed; 1 a check failed; 2 a usage error or a missing prerequisite.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import zlib from 'node:zlib';
import { scanTree } from './neutrality-scan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_PORT = 8570;                                                // the product's port
const TEST_PORT = 18570, PROXY_HTTP = 18480, PROXY_HTTPS = 18443;     // on this machine, for the Docker check
const BASE_IMAGE = 'node:24-slim', PROXY_IMAGE = 'caddy:2';
const BACKUP_NAMES = ['meta.json', 'people.json', 'world.json', 'next.db'];
const LINE = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z (info|warn|error) \[[^\]]+\] |  )/;
const USAGE = 'usage: node tools/install-check.mjs docker|native|all [--ref <git ref>] [--private <file>] [--log <file>] [--keep]';

let logFd = null, passed = 0, failed = 0;
function out(line = '') {
  process.stdout.write(`${line}\n`);
  if (logFd !== null) fs.writeSync(logFd, `${line}\n`);
}
function check(ok, what, detail = '') {
  if (ok) passed++; else failed++;
  out(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ` (${detail})` : ''}`);
  return ok;
}
const note = s => out(`      ${s}`);
const section = s => { out(); out(`== ${s}`); };
const tail = (text, n = 25) => { for (const l of String(text || '').trimEnd().split('\n').slice(-n)) note(`| ${l}`); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const secs = t0 => Math.round((Date.now() - t0) / 1000);
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
const why = r => (r ? `HTTP ${r.status}${r.json && r.json.code ? ` ${r.json.code}` : ''}` : 'no answer');
const newPassword = () => `Chk-${crypto.randomBytes(18).toString('base64url')}`;

/** Runs a command and waits: { status, stdout, stderr }. */
function run(cmd, args, { cwd, env, input, timeout = 600000, binary = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, input, timeout, maxBuffer: 256 << 20, encoding: binary ? 'buffer' : 'utf8' });
  const empty = binary ? Buffer.alloc(0) : '';
  if (r.error && r.error.code === 'ENOENT') return { status: 127, stdout: empty, stderr: `${cmd}: not found` };
  return { status: r.status ?? 1, stdout: r.stdout ?? empty, stderr: String(r.stderr ?? '') + (r.error ? `\n${r.error.message}` : '') };
}

/** The environment for docker compose, without any of the product's settings, so this shell's cannot leak in. */
function composeEnv(extra) {
  const e = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!/^(MVW_|COMPOSE_)/.test(k) && !['PORT', 'HOST'].includes(k)) e[k] = v;
  }
  return { ...e, ...extra };
}

/** One HTTP(S) request with a chosen Host header. The test proxy's certificate comes from its own authority for
 *  localhost, which this machine does not trust, so HTTPS certificates are not verified here. */
function request(url, { method = 'GET', headers = {}, body, servername, timeoutMs = 15000 } = {}) {
  const u = new URL(url), tls = u.protocol === 'https:';
  const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const h = { ...headers };
  if (data) { h['content-type'] = 'application/json'; h['content-length'] = data.length; }
  const opts = { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: h, timeout: timeoutMs };
  if (tls) Object.assign(opts, { servername: servername || 'localhost', rejectUnauthorized: false });
  return new Promise((resolve, reject) => {
    const req = (tls ? https : http).request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`no answer from ${u.host} within ${timeoutMs} ms`)));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/** A browser-like session: the session cookie and the CSRF token of "me" answers. */
class Session {
  constructor(origin, hostHeader, servername) {
    Object.assign(this, { origin, hostHeader, servername, cookie: '', csrf: null });
  }
  async send(method, p, body) {
    const h = { host: this.hostHeader };
    if (this.cookie) h.cookie = this.cookie;
    if (method !== 'GET' && this.csrf) h['x-csrf-token'] = this.csrf;
    const r = await request(this.origin + p, { method, headers: h, body, servername: this.servername });
    const sc = r.headers['set-cookie'];
    if (sc && sc.length) {
      const m = /^([^=;\s]+)=([^;]*)/.exec(sc[0]);
      this.cookie = m && m[2] ? `${m[1]}=${m[2]}` : '';
      if (!this.cookie) this.csrf = null;
    }
    if (r.json && typeof r.json === 'object' && 'csrf' in r.json && 'caps' in r.json) this.csrf = r.json.csrf;
    return r;
  }
  get(p) { return this.send('GET', p); }
  post(p, body = {}) { return this.send('POST', p, body); }
}

/** 'open', 'refused', 'no answer' or an error code. */
function tcpProbe(host, port, timeoutMs = 3000) {
  return new Promise(resolve => {
    const s = net.connect({ host, port });
    const done = v => { s.destroy(); resolve(v); };
    s.setTimeout(timeoutMs, () => done('no answer'));
    s.on('connect', () => done('open'));
    s.on('error', e => done(e.code === 'ECONNREFUSED' ? 'refused' : e.code || e.message));
  });
}

/** The names in a ustar archive, checking each header's magic and checksum. */
function tarNames(buf) {
  const names = [];
  for (let off = 0; off + 512 <= buf.length;) {
    const h = buf.subarray(off, off + 512);
    if (h.every(b => b === 0)) break;
    const name = h.toString('utf8', 0, 100).replace(/\0[\s\S]*$/, '');
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (h.toString('ascii', 257, 262) !== 'ustar' || parseInt(h.toString('ascii', 148, 156), 8) !== sum) throw new Error(`a broken header at ${name}`);
    names.push(name);
    off += 512 + Math.ceil(parseInt(h.toString('ascii', 124, 136), 8) / 512) * 512;
  }
  return names;
}

/** Polls a container until its health check says healthy (or it fails or stops). */
async function waitHealthy(id, ms) {
  const t0 = Date.now();
  let status = 'unknown';
  while (Date.now() - t0 < ms) {
    const r = run('docker', ['inspect', '-f', '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}', id]);
    const [state, health] = r.stdout.trim().split(' ');
    status = health ? `${state}, ${health}` : state || 'gone';
    if (health === 'healthy') return { ok: true, status: 'healthy' };
    if (health === 'unhealthy' || !['running', 'restarting', 'created'].includes(state)) return { ok: false, status };
    await sleep(2000);
  }
  return { ok: false, status: `${status}, timed out` };
}

async function dockerCheck(src, stamp, o) {
  section('Docker: compose.yaml from a clean export, as docs/INSTALL.md describes');
  const project = `mvw-install-check-${stamp}`, image = `mvw-install-check:${stamp}`;
  note(`Docker ${run('docker', ['version', '--format', '{{.Server.Version}}']).stdout.trim()}, Compose ${run('docker', ['compose', 'version', '--short']).stdout.trim()}; `
    + `project ${project}, image ${image}; the app on port ${TEST_PORT}, the proxy on ${PROXY_HTTP} and ${PROXY_HTTPS}`);
  const guide = fs.readFileSync(path.join(src, 'docs', 'INSTALL.md'), 'utf8');
  const guideCmds = ['docker compose up -d', 'docker compose logs app', 'docker compose exec app cat /data/setup-code.txt',
    'docker compose exec -T app node tools/admin.mjs backup > world-backup.tar.gz', 'MVW_DOMAIN=', 'COMPOSE_PROFILES=proxy'];
  const missing = guideCmds.filter(c => !guide.includes(c));
  check(!missing.length, "the steps checked here are the install guide's", missing.join(' | '));
  for (const p of [TEST_PORT, PROXY_HTTP, PROXY_HTTPS]) {
    if ((await tcpProbe('127.0.0.1', p, 1000)) === 'open') return check(false, `port ${p} on the loopback address is free for the check`);
  }
  const proxyImageBefore = run('docker', ['image', 'inspect', PROXY_IMAGE]).status === 0;
  const env = composeEnv({ MVW_IMAGE: image, MVW_PORT: String(TEST_PORT) });
  const proxyEnv = { MVW_DOMAIN: 'localhost', MVW_HTTP_PORT: String(PROXY_HTTP), MVW_HTTPS_PORT: String(PROXY_HTTPS) };
  const compose = (args, x = {}) => run('docker', ['compose', '-p', project, ...args], { cwd: src, env: { ...env, ...(x.env || {}) }, binary: x.binary, timeout: x.timeout });
  const inApp = (args, x) => compose(['exec', '-T', 'app', ...args], x);
  try {
    let t0 = Date.now();
    const up = compose(['up', '-d', '--build'], { timeout: 1200000 });
    if (!check(up.status === 0, 'docker compose up -d builds the image and starts the app', `${secs(t0)} s`)) return tail(up.stderr);
    const id = compose(['ps', '-q', 'app']).stdout.trim();
    const h = await waitHealthy(id, 240000);
    if (!check(h.ok, 'the app becomes healthy: its health check asks /api/ready', `${h.status} after ${secs(t0)} s`)) {
      return tail(compose(['logs', '--no-color', '--no-log-prefix', '--tail', '40', 'app']).stdout);
    }

    const sc = inApp(['cat', '/data/setup-code.txt']);
    const code = (/^Setup code: (\S+)$/m.exec(sc.stdout || '') || [])[1];
    if (!check(sc.status === 0 && !!code, 'the one-time setup code is in /data/setup-code.txt')) return;
    const firstLog = compose(['logs', '--no-color', 'app']).stdout || '';
    check(firstLog.includes(`Setup code: ${code}`), 'and in the app\'s output (docker compose logs app)');
    const origin = `http://127.0.0.1:${TEST_PORT}`;
    const s = new Session(origin, `localhost:${TEST_PORT}`);
    const chosen = newPassword();
    const si = await s.post('/api/auth/setup', { code, login: 'owner', displayName: 'Owner', password: chosen });
    const me = await s.get('/api/auth/me');
    check(si.status === 201 && me.json && me.json.role === 'owner' && me.json.secure === true && !me.json.restricted && me.json.setup === false,
      `the administrator account is made with it over plain HTTP at http://localhost:${TEST_PORT} on the Docker host: signed in as the owner, over a connection the server counts as secure`,
      `${why(si)}; me: role ${me.json && me.json.role}, secure ${me.json && me.json.secure}`);
    const w = await s.get('/api/world');
    check(w.json && w.json.world && w.json.world.buildings.filter(B => B && !B.gone).length > 50, 'the world is the starting map', `${w.json && w.json.world && w.json.world.buildings.length} buildings`);

    const other = await request(`${origin}/api/auth/me`, { headers: { host: `world.example:${TEST_PORT}` } });
    const otherSignin = await request(`${origin}/api/auth/signin`, { method: 'POST', headers: { host: `world.example:${TEST_PORT}` }, body: { login: 'owner', password: chosen } });
    check(other.json && other.json.secure === false && otherSignin.status !== 200,
      'a request that names another host is not secure, and signing in there is refused', `${why(otherSignin)}`);
    const lan = Object.values(os.networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal);
    if (lan) {
      const r = await tcpProbe(lan.address, TEST_PORT, 3000);
      check(r !== 'open', 'other machines cannot reach the app: the port is published on the loopback address only', `a non-loopback address of this machine: ${r}`);
    } else note('no non-loopback IPv4 address to probe');

    // The container's processes as the host sees them (docker top): the server and the init process that starts it.
    // docker top needs the PID column to pick out the container's processes.
    const procs = run('docker', ['top', id, '-o', 'pid,uid,args']).stdout.split('\n').slice(1)
      .map(l => l.trim().match(/^(\S+)\s+(\S+)\s+(.*)$/)).filter(m => m && m[3].includes('server/index.mjs'));
    const uids = [...new Set(procs.map(m => m[2]))];
    check(procs.length > 0 && uids.every(u => u !== '0' && u !== 'root'), 'the server runs as an unprivileged user', `uid ${uids.join(', ') || 'none found'}`);
    const vols = run('docker', ['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`]).stdout.split('\n').filter(Boolean);
    check(vols.includes(`${project}_data`) && vols.includes(`${project}_keys`), 'the world and the key live in two named volumes', vols.map(v => v.slice(project.length + 1)).join(', '));
    const key = inApp(['stat', '-c', '%a', '/keys/secret.key']).stdout.trim();
    const dataFiles = inApp(['ls', '-A', '/data']).stdout.split('\n').filter(Boolean);
    check(key === '600' && !dataFiles.some(f => /secret|\.key$/.test(f)), 'the key file was created at the first start, readable only by the server, outside the data volume',
      `mode ${key || 'missing'}; /data: ${dataFiles.join(' ')}`);

    const worldId = () => inApp(['node', '-e', "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/data/world.json', 'utf8')).worldId || ''))"]).stdout.trim();
    const id1 = worldId();
    t0 = Date.now();
    const rs = compose(['restart', 'app'], { timeout: 180000 });
    const h2 = await waitHealthy(id, 240000);
    const id2 = worldId();
    check(rs.status === 0 && h2.ok && !!id1 && id1 === id2, 'after docker compose restart the app is healthy again, with the same world', `${h2.status} after ${secs(t0)} s`);
    const logs = compose(['logs', '--no-color', '--no-log-prefix', 'app']).stdout;
    check(/ info \[shutdown\] SIGTERM: saving and closing$/m.test(logs) && / info \[shutdown\] done$/m.test(logs), 'the restart shut the server down gracefully (saved, exit 0)');
    const me2 = await s.get('/api/auth/me');
    check(me2.json && me2.json.role === 'owner', 'and the owner is still signed in', `role ${me2.json && me2.json.role}`);

    const bk = inApp(['node', 'tools/admin.mjs', 'backup'], { binary: true });
    let names = [];
    try { names = tarNames(zlib.gunzipSync(bk.stdout)); } catch (e) { names = [`unreadable: ${e.message}`]; }
    check(bk.status === 0 && BACKUP_NAMES.every(n => names.includes(n)) && !names.some(n => /secret|first-owner|setup-code/.test(n)),
      'node tools/admin.mjs backup writes the world and the accounts to standard output, without the key', names.join(', '));

    t0 = Date.now();
    const pu = compose(['--profile', 'proxy', 'up', '-d'], { env: proxyEnv, timeout: 900000 });
    if (!check(pu.status === 0, 'docker compose --profile proxy up -d adds the reverse proxy', `${secs(t0)} s`)) return tail(pu.stderr);
    note(`${PROXY_IMAGE}: ${run('docker', ['image', 'inspect', '-f', '{{index .RepoDigests 0}}', PROXY_IMAGE]).stdout.trim()}`);
    const ps = new Session(`https://127.0.0.1:${PROXY_HTTPS}`, `localhost:${PROXY_HTTPS}`, 'localhost');
    let ready = null;
    const t1 = Date.now();
    while (Date.now() - t1 < 120000) {
      try { ready = await ps.get('/api/ready'); if (ready.status === 200) break; } catch { ready = null; }
      await sleep(1500);
    }
    check(!!ready && ready.status === 200, `the app answers through the proxy at https://localhost:${PROXY_HTTPS}`, `${why(ready)} after ${secs(t1)} s`);
    const psi = await ps.post('/api/auth/signin', { login: 'owner', password: chosen });
    const pme = await ps.get('/api/auth/me');
    check(psi.status === 200 && pme.json && pme.json.secure === true && pme.json.role === 'owner',
      'the owner signs in through the proxy: the app trusts the forwarded headers from its fixed address', `${why(psi)}; secure ${pme.json && pme.json.secure}`);
    try {
      const redirect = await request(`http://127.0.0.1:${PROXY_HTTP}/`, { headers: { host: `localhost:${PROXY_HTTP}` } });
      note(`plain HTTP on the proxy: ${why(redirect)}${redirect.headers.location ? ` to ${redirect.headers.location}` : ''}`);
    } catch (e) { note(`plain HTTP on the proxy: ${e.message}`); }
    return null;
  } finally {
    if (o.keep) note(`kept: docker compose -p ${project} --profile proxy down -v (in ${src}); docker image rm ${image}`);
    else {
      const down = compose(['--profile', 'proxy', 'down', '-v', '--remove-orphans'], { env: proxyEnv, timeout: 300000 });
      run('docker', ['image', 'rm', image]);
      if (!proxyImageBefore) run('docker', ['image', 'rm', PROXY_IMAGE]);
      const left = [
        ['containers', run('docker', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`]).stdout.trim()],
        ['volumes', run('docker', ['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`]).stdout.trim()],
        ['networks', run('docker', ['network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`]).stdout.trim()],
        ['image', run('docker', ['image', 'ls', '-q', image]).stdout.trim()],
      ].filter(([, v]) => v).map(([k]) => k);
      check(down.status === 0 && !left.length, `everything the check created is removed${proxyImageBefore ? '' : `, ${PROXY_IMAGE} too`}`, left.length ? `left: ${left.join(', ')}` : '');
    }
  }
}

// Signs in as the first owner from inside the native container, so the temporary password never leaves it. Prints
// only what it found, as JSON.
const NATIVE_SIGNIN = String.raw`
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
const port = Number(process.env.APP_PORT), file = process.env.SETUP_FILE;
let cookie = '', csrf = null;
function send(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { host: 'localhost:' + port };
    if (cookie) headers.cookie = cookie;
    if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = data.length; }
    if (method !== 'GET' && csrf) headers['x-csrf-token'] = csrf;
    const req = http.request({ hostname: '127.0.0.1', port, path: p, method, headers, timeout: 15000 }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const sc = res.headers['set-cookie'];
        if (sc && sc.length) { const m = /^([^=;\s]+)=([^;]*)/.exec(sc[0]); cookie = m && m[2] ? m[1] + '=' + m[2] : ''; }
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
        if (json && typeof json === 'object' && 'csrf' in json && 'caps' in json) csrf = json.csrf;
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const result = {};
const code = (/^Setup code: (\S+)$/m.exec(fs.readFileSync(file, 'utf8')) || [])[1];
result.setupFile = !!code;
if (code) {
  const si = await send('POST', '/api/auth/setup', { code, login: 'owner', displayName: 'Owner', password: 'Chk-' + crypto.randomBytes(18).toString('base64url') });
  result.setup = si.status;
  const me = (await send('GET', '/api/auth/me')).json || {};
  Object.assign(result, { role: me.role, secure: me.secure, restricted: !!me.restricted, setupFileGone: !fs.existsSync(file) });
}
process.stdout.write(JSON.stringify(result));
`;

async function nativeCheck(src, stamp, o) {
  section('Native: docs/INSTALL.md in a fresh node:24-slim container, as root (no systemd inside it)');
  const unitFile = path.join(src, 'docs', 'examples', 'my-virtual-world.service');
  const unit = fs.readFileSync(unitFile, 'utf8');
  const val = k => (unit.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1] || '';
  const user = val('User'), wd = val('WorkingDirectory'), mode = val('StateDirectoryMode') || '0755', umask = val('UMask') || '0022';
  const envList = [...unit.matchAll(/^Environment=(\S+)$/gm)].map(m => m[1]);
  const env = Object.fromEntries(envList.map(e => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)]));
  const stateDirs = val('StateDirectory').split(/\s+/).filter(Boolean).map(d => `/var/lib/${d}`);
  const data = env.MVW_DATA, keyFile = env.MVW_KEY_FILE, port = Number(env.PORT || APP_PORT);

  if (run('systemd-analyze', ['--version']).status === 0) {
    const v = run('systemd-analyze', ['verify', unitFile]);
    check(v.status === 0 && !v.stderr.trim(), 'systemd-analyze verify accepts the example unit', v.stderr.trim().split('\n')[0]);
    const sec = run('systemd-analyze', ['security', '--offline=true', unitFile]);
    const m = /Overall exposure level for \S+: ([\d.]+) (\S+)/.exec(sec.stdout + sec.stderr);
    check(!!m && Number(m[1]) <= 3, "systemd-analyze security rates the unit's sandboxing", m ? `${m[1]} ${m[2]}` : 'no rating');
  } else note('systemd-analyze is not installed here: the unit file itself was not checked');
  const guide = fs.readFileSync(path.join(src, 'docs', 'INSTALL.md'), 'utf8');
  const guideCmds = [`sudo useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin ${user}`, 'sudo npm ci --omit=dev --ignore-scripts',
    'sudo cp docs/examples/my-virtual-world.service /etc/systemd/system/', `sudo cat ${data}/setup-code.txt`,
    `sudo -u ${user} node tools/admin.mjs backup --data ${data} > world-backup.tar.gz`];
  const missing = guideCmds.filter(c => !guide.includes(c));
  check(!missing.length, "the commands checked here are the install guide's", missing.join(' | '));

  const name = `mvw-install-native-${stamp}`;
  const started = run('docker', ['run', '-d', '--name', name, '-v', `${src}:/src:ro`, BASE_IMAGE, 'sleep', 'infinity']);
  if (!check(started.status === 0, `a fresh ${BASE_IMAGE} container starts`, run('docker', ['image', 'inspect', '-f', '{{index .RepoDigests 0}}', BASE_IMAGE]).stdout.trim())) {
    return tail(started.stderr);
  }
  const sh = (script, x = {}) => run('docker', ['exec', name, 'sh', '-c', script], { timeout: x.timeout });
  try {
    let t0 = Date.now();
    const s1 = sh([
      'set -e',
      `useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin ${q(user)}`,
      'umask 022',                       // as for sudo git clone
      `install -d -m 0755 ${q(wd)}`,
      `cp -R /src/. ${q(wd)}/`,          // stands in for git clone of the export being checked: new files, root's umask
      `chown -R root:root ${q(wd)}`,
      `cd ${q(wd)}`,
      'npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error',
    ].join('\n'), { timeout: 900000 });
    if (!check(s1.status === 0, 'step 1: the service user, the code in /opt owned by root, and its production dependencies', `${secs(t0)} s`)) return tail(s1.stderr);

    // Step 2, as systemd would start the unit: its state folders, then its command as its user, with its umask, working
    // folder and environment only. The guide says to change ExecStart when node lives elsewhere; in this image it does.
    const mk = sh(`install -d -m ${q(mode)} -o ${q(user)} -g ${q(user)} ${stateDirs.map(q).join(' ')}`);
    const cmd = val('ExecStart').replace(/^\/usr\/bin\/node(?=\s)/, '"$(command -v node)"');
    const inner = `umask ${umask}; ${cmd} > /tmp/mvw-server.log 2>&1 & echo $! > /tmp/mvw-server.pid; wait $!; echo $? > /tmp/mvw-server.exit`;
    const launch = `cd ${q(wd)} && exec runuser -u ${q(user)} -- env -i PATH=/usr/local/bin:/usr/bin:/bin ${envList.map(q).join(' ')} sh -c ${q(inner)}`;
    t0 = Date.now();
    const st = run('docker', ['exec', '-d', name, 'sh', '-c', launch]);
    let ready = false;
    while (mk.status === 0 && st.status === 0 && Date.now() - t0 < 240000) {
      if (run('docker', ['exec', name, 'node', '-e', `fetch('http://127.0.0.1:${port}/api/ready').then(r => process.exit(r.status === 200 ? 0 : 1), () => process.exit(1))`]).status === 0) { ready = true; break; }
      if (sh('test -f /tmp/mvw-server.exit').status === 0) break;
      await sleep(1000);
    }
    if (!check(ready, 'step 2: started as the example unit starts it, the server becomes ready', `${secs(t0)} s`)) {
      tail(mk.stderr + st.stderr);
      return tail(sh('tail -n 40 /tmp/mvw-server.log').stdout);
    }
    const perms = sh(`stat -c '%n %a %U' ${[...stateDirs, keyFile].map(q).join(' ')}`).stdout.trim().split('\n');
    const want = [...stateDirs.map(d => `${d} ${mode.replace(/^0/, '')} ${user}`), `${keyFile} 600 ${user}`];
    check(want.every(w => perms.includes(w)), 'the state folders belong to the service user (0700), and the server created the key file (0600)', perms.map(p => p.split(' ').slice(1).join(' ')).join('; '));
    const code = sh(`find ${q(wd)} ! -user root -print -quit; test ! -e ${q(`${wd}/data`)} && echo unchanged`);
    check(code.stdout.trim() === 'unchanged', 'the service wrote nothing into the code folder', code.stdout.trim().split('\n')[0]);

    const si = run('docker', ['exec', '-i', '-e', `SETUP_FILE=${data}/setup-code.txt`, '-e', `APP_PORT=${port}`, name, 'node', '--input-type=module', '-'], { input: NATIVE_SIGNIN, timeout: 60000 });
    let r = {};
    try { r = JSON.parse(si.stdout); } catch { tail(si.stderr); }
    check(r.setupFile === true, `step 3: the one-time setup code is in ${data}/setup-code.txt`);
    check(r.setup === 201 && r.role === 'owner' && r.secure === true && !r.restricted, `step 4: the administrator account is made with it over plain HTTP at http://localhost:${port} on the server itself; the server counts the connection as secure`,
      `HTTP ${r.setup}; role ${r.role}, secure ${r.secure}`);
    check(r.setupFileGone === true, 'the setup code\'s file is deleted once it is used');

    const adm = sh(`cd ${q(wd)} && runuser -u ${q(user)} -- node tools/admin.mjs status --data ${q(data)} --key-file ${q(keyFile)}`);
    check(adm.status === 0 && /^owner +owner \(Owner\), active/m.test(adm.stdout) && /^key +/m.test(adm.stdout), 'node tools/admin.mjs status, as the service user', adm.stderr.trim().split('\n')[0]);
    const bk = sh(`cd ${q(wd)} && runuser -u ${q(user)} -- node tools/admin.mjs backup --data ${q(data)} > /tmp/world-backup.tar.gz && tar -tzf /tmp/world-backup.tar.gz`);
    const names = bk.stdout.split('\n').filter(Boolean);
    check(bk.status === 0 && BACKUP_NAMES.every(n => names.includes(n)) && !names.some(n => /secret|first-owner|setup-code/.test(n)),
      'node tools/admin.mjs backup, as the service user; tar reads the archive', names.join(', '));

    const term = sh('kill -TERM "$(cat /tmp/mvw-server.pid)"; for i in $(seq 1 40); do [ -f /tmp/mvw-server.exit ] && break; sleep 0.5; done; cat /tmp/mvw-server.exit', { timeout: 60000 });
    check(term.stdout.trim() === '0', 'SIGTERM (systemctl stop) saves and exits 0', `exit ${term.stdout.trim() || 'none'}`);
    const log = sh('cat /tmp/mvw-server.log').stdout;
    const odd = log.split('\n').filter(l => l && !LINE.test(l));
    check(/ info \[shutdown\] done$/m.test(log) && !odd.length, 'every log line reads "time level [area] message"', odd[0] || '');
    check(!/^\S+ warn /m.test(log), 'the server started without warnings', (log.match(/^\S+ warn .*$/m) || [''])[0]);
    return null;
  } finally {
    if (o.keep) note(`kept: docker rm -f ${name}`);
    else {
      const rm = run('docker', ['rm', '-f', name]);
      check(rm.status === 0 && !run('docker', ['ps', '-aq', '--filter', `name=^${name}$`]).stdout.trim(), 'the container is removed');
    }
  }
}

async function main(argv) {
  let a;
  try {
    a = parseArgs({ args: argv, allowPositionals: true, options: {
      ref: { type: 'string', default: 'HEAD' }, private: { type: 'string' }, log: { type: 'string' }, keep: { type: 'boolean', default: false },
    } });
  } catch (e) { console.error(`${e.message}\n${USAGE}`); return 2; }
  const mode = a.positionals[0], o = a.values;
  if (!['docker', 'native', 'all'].includes(mode) || a.positionals.length !== 1) { console.error(USAGE); return 2; }
  if (run('docker', ['info', '--format', '{{.ServerVersion}}']).status !== 0) { console.error('Docker is not available: docker info failed'); return 2; }
  if (run('docker', ['image', 'inspect', BASE_IMAGE]).status !== 0 && run('docker', ['pull', BASE_IMAGE]).status !== 0) { console.error(`cannot get ${BASE_IMAGE}`); return 2; }
  const commit = run('git', ['-C', ROOT, 'rev-parse', '--verify', '--short', `${o.ref}^{commit}`]);
  if (commit.status !== 0) { console.error(`not a commit: ${o.ref}`); return 2; }
  let privateText = null;
  if (o.private) {
    try { privateText = fs.readFileSync(o.private, 'utf8'); } catch (e) { console.error(e.message); return 2; }
  }
  if (o.log) logFd = fs.openSync(o.log, 'w', 0o644);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  out(`install check (${mode}) of ${o.ref} = ${commit.stdout.trim()}, ${new Date().toISOString()}`);

  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-install-src-'));
  try {
    section('The exported tree');
    const tar = spawnSync('git', ['-C', ROOT, 'archive', '--format=tar', o.ref], { maxBuffer: 1 << 30 });
    const x = tar.status === 0 ? spawnSync('tar', ['-x', '-C', src], { input: tar.stdout }) : tar;
    if (!check(x.status === 0, `git archive ${o.ref} exports the tree`, String(x.stderr || '').trim())) return 1;
    const allow = JSON.parse(fs.readFileSync(path.join(src, 'tools', 'neutrality-allow.json'), 'utf8'));
    const sr = scanTree(src, { allow, privateText });
    check(!sr.findings.length && !sr.unused.length, `the neutrality scan${privateText ? ' with the private list' : ''} finds nothing tied to one installation`,
      `${sr.files} files read; ${sr.findings.length} findings, ${sr.unused.length} unused exceptions`);
    for (const f of sr.findings.slice(0, 20)) note(`${f.file}:${f.line} ${f.rule}`);
    if (mode !== 'native') await dockerCheck(src, stamp, o);
    if (mode !== 'docker') await nativeCheck(src, stamp, o);
  } finally {
    if (o.keep) note(`kept the export in ${src}`);
    else fs.rmSync(src, { recursive: true, force: true });
    out();
    out(`install check (${mode}): ${passed} passed, ${failed} failed`);
    if (logFd !== null) fs.closeSync(logFd);
  }
  return failed ? 1 : 0;
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; }, e => { console.error(e.stack || e.message); process.exitCode = 1; });
