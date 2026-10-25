// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Throwaway servers for the tests and tools: a free port (PORT=0) and a temporary data folder. Never the live world.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA_FILES = ['world.json', 'people.json', 'meta.json'];

/** A small HTTP client for one browser: keeps the session cookie, and sends the session's CSRF token on writes. */
export function httpClient(base) {
  const c = {
    base, cookie: '', csrf: null, me: null, login: null, password: null,
    async request(method, p, body, headers = {}) {
      const h = { ...(c.cookie ? { cookie: c.cookie } : {}), ...headers };
      const has = name => Object.keys(h).some(k => k.toLowerCase() === name);
      if (body !== undefined && !has('content-type')) h['content-type'] = 'application/json';
      if (method !== 'GET' && c.csrf && !Object.keys(h).some(k => k.toLowerCase() === 'x-csrf-token')) h['x-csrf-token'] = c.csrf;
      const r = await fetch(new URL(p, base), {
        method, headers: h, body: body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body),
      });
      const sc = r.headers.get('set-cookie');
      if (sc) {
        const m = /^([^=;\s]+)=([^;]*)/.exec(sc);
        c.cookie = m && m[2] ? `${m[1]}=${m[2]}` : '';
        if (!c.cookie) c.csrf = null;
      }
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      if (json && typeof json === 'object' && 'csrf' in json && 'caps' in json) { c.csrf = json.csrf; c.me = json; }   // a "me" answer
      return { status: r.status, json, text, headers: r.headers };
    },
    get(p, headers) { return c.request('GET', p, undefined, headers); },
    post(p, body = {}, headers) { return c.request('POST', p, body, headers); },
    async signIn(login, password) {
      const r = await c.post('/api/auth/signin', { login, password });
      if (r.status !== 200) throw new Error(`sign-in as ${login} failed: ${r.status} ${r.text}`);
      c.login = login;
      c.password = password;
      return r;
    },
  };
  return c;
}

/** A password that passes the server's policy (random, 28 characters). */
export const strongPassword = () => `Tst-${crypto.randomBytes(18).toString('base64url')}`;

/** The setup code of a new server's data folder (throwaway servers only; never print it). */
export function setupCodeOf(dataDir) {
  const text = fs.readFileSync(path.join(dataDir, 'setup-code.txt'), 'utf8');
  const m = /^Setup code: (\S+)$/m.exec(text);
  if (!m) throw new Error('setup-code.txt has no setup code line');
  return m[1];
}
/** The first owner's temporary password after tools/admin.mjs reset-owner (throwaway servers only; never print it). */
export function ownerTempPassword(dataDir) {
  const text = fs.readFileSync(path.join(dataDir, 'first-owner-password.txt'), 'utf8');
  const m = /^Temporary password: (\S+)$/m.exec(text);
  if (!m) throw new Error('first-owner-password.txt has no temporary password line');
  return m[1];
}

/** Creates the administrator ("owner") with the setup code, as whoever installs a server does: a signed-in owner client.
 *  On a server whose owner exists already, signs in with the password it was made with. */
export async function ownerSession(server) {
  const c = httpClient(server.url);
  if (server.ownerPassword) { await c.signIn('owner', server.ownerPassword); c.password = server.ownerPassword; return c; }
  const password = strongPassword();
  const r = await c.post('/api/auth/setup', { code: setupCodeOf(server.data), login: 'owner', displayName: 'Owner', password });
  if (r.status !== 201) throw new Error(`setting up the owner failed: ${r.status} ${r.text}`);
  c.login = 'owner'; c.password = password; server.ownerPassword = password;
  if (!server.demo) await importTestLicence(c);
  return c;
}

/** Where the test licence lives: release 1's activated receipt (its key and activation id only), outside the repo,
 *  readable only by its owner (WP1.11). Never printed. */
export const TEST_LICENCE_FILE = process.env.MVW_TEST_LICENCE_FILE || path.join(os.homedir(), '.config/mvw-next/test-licence.json');
/** Licenses a throwaway server the way an owner does: uploads the release 1 receipt; the server validates it with
 *  Lemon Squeezy itself (no new activation is used). There is no other way to unlock a server. */
export async function importTestLicence(owner) {
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(TEST_LICENCE_FILE, 'utf8')); } catch {
    throw new Error(`No test licence at ${TEST_LICENCE_FILE}: tests that edit the world need release 1's activated receipt there (see docs/parity/PROGRESS.md, WP1.11), or start the server with { demo: true }`);
  }
  // The licence server is on the internet: the full suite asks it from many servers at once, and a few of those time out
  // now and then. Only "unreachable" is asked again (three tries, a few seconds apart); a refusal fails at once.
  let r;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(res => setTimeout(res, 2000 + 3000 * attempt + Math.random() * 1000));
    r = await owner.post('/api/licence/import', { receipt });
    if (r.status === 200 || !(r.json && r.json.code === 'unreachable')) break;
  }
  if (r.status !== 200) throw new Error(`importing the test licence failed: ${r.status} ${r.json && r.json.code}: ${r.json && r.json.error}`);
  return r.json;
}

/** Creates an account through an owner or admin client, signs in and replaces its temporary password. */
export async function userSession(server, creator, { login, displayName, role = 'member' }) {
  const r = await creator.post('/api/users', { login, displayName: displayName || login, role });
  if (r.status !== 201) throw new Error(`creating ${login} failed: ${r.status} ${r.text}`);
  const c = httpClient(server.url), password = strongPassword();
  await c.signIn(login, r.json.temporaryPassword);
  const p = await c.post('/api/account/password', { current: r.json.temporaryPassword, password });
  if (p.status !== 200) throw new Error(`${login}: password change failed: ${p.status} ${p.text}`);
  c.password = password;
  c.id = r.json.user.id;
  return c;
}

export function tempDir(prefix = 'mvw-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Copies the saved world, residents and clock of a data folder into dir (reading is safe while a server runs). */
export function copyData(from, dir) {
  if (!fs.existsSync(path.join(from, 'world.json'))) throw new Error(`no world.json in ${from}`);
  for (const f of DATA_FILES) {
    if (fs.existsSync(path.join(from, f))) fs.copyFileSync(path.join(from, f), path.join(dir, f));
  }
}

/** Writes a generated city whose residents include `agents` AI-agent residents with test identities, so tests of
 *  agent-only behaviour run on every machine (agents normally join through connections; DECISIONS C103). */
export async function seedCity(dir, { population = 200, agents = 3, seed = 'test-city' } = {}) {
  const { generateWorld } = await import('../../server/world/generate.js');
  const { generatePopulation } = await import('../../server/sim/population.js');
  const { WorldIndex } = await import('../../server/sim/windex.js');
  const world = generateWorld({ seed, population });
  const roster = Array.from({ length: agents }, (_, k) => ({ agentId: `test-agent-${k + 1}`, name: `Test Agent ${k + 1}`, emoji: '🤖', role: 'Test agent' }));
  const people = generatePopulation(world, new WorldIndex(world), { population, roster });
  fs.writeFileSync(path.join(dir, 'world.json'), JSON.stringify(world));
  fs.writeFileSync(path.join(dir, 'people.json'), JSON.stringify(people));
}

/**
 * Starts `node server/index.mjs` and resolves once it listens.
 * @param {object} [o]
 * @param {string} [o.root]        code folder to run (default: this checkout; a release folder works too)
 * @param {string} [o.data]        data folder to use (default: a new temporary folder that stop() removes)
 * @param {string} [o.copyFrom]    data folder whose world and residents are copied into the new folder first
 * @param {number} [o.population]  residents when a new city is generated
 * @param {number} [o.agents]      AI-agent residents in a new city (seedCity)
 * @param {object} [o.env]         extra environment variables
 * @param {number} [o.timeoutMs]   how long to wait for the server to listen
 */
export async function startServer({ root = ROOT, data = null, copyFrom = null, population = 200, agents = 0, env = {}, timeoutMs = 30000, demo = false } = {}) {
  const own = !data;
  const dir = data || tempDir();
  if (copyFrom) copyData(copyFrom, dir);
  else if (agents > 0) await seedCity(dir, { population, agents });
  // The key for stored secrets (DECISIONS C86): a key file next to the data folder, outside it, unless the caller sets
  // MVW_KEY_FILE or MVW_SECRET_KEY itself (even empty, to test the refusal). Inherited key settings are never used.
  const inherited = { ...process.env };
  for (const k of ['MVW_KEY_FILE', 'MVW_SECRET_KEY', 'MVW_SECRET_KEY_PREVIOUS']) delete inherited[k];
  const keyEnv = 'MVW_KEY_FILE' in env || 'MVW_SECRET_KEY' in env ? {} : { MVW_KEY_FILE: `${dir}.key` };
  const keyFile = keyEnv.MVW_KEY_FILE || env.MVW_KEY_FILE || null;
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    env: { ...inherited, PORT: '0', HOST: '127.0.0.1', MVW_DATA: dir, MVW_POPULATION: String(population), MVW_HOUSING: 'off', MVW_STARTER_MAP: 'off', MVW_SOUNDTRACK: 'off', ...keyEnv, ...env },   // (a test's residents stay as many as it asked for; MVW_HOUSING: 'on' to see them follow the homes; MVW_SOUNDTRACK: 'on' for the soundtrack in the music library)
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const cleanUp = () => {
    if (!own) return;
    fs.rmSync(dir, { recursive: true, force: true });
    if (keyEnv.MVW_KEY_FILE) fs.rmSync(keyEnv.MVW_KEY_FILE, { force: true });
  };
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`the server did not start within ${timeoutMs} ms:\n${out}`));
    }, timeoutMs);
    const onData = d => {
      out += d;
      const m = out.match(/listening on http:\/\/[^\s:]+:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    exited.then(({ code, signal }) => {
      clearTimeout(timer);
      reject(new Error(`the server exited early (${code ?? signal}):\n${out}`));
    });
  }).catch(e => { cleanUp(); throw e; });
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    pid: child.pid,
    demo,   // true: ownerSession() leaves it in demo mode (no licence imported)
    data: dir,
    keyFile,
    log: () => out,
    /** Stops the server with SIGTERM (it saves on stop); removes its data folder unless one was given or keepData is set. */
    async stop({ keepData = false } = {}) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      let timer;
      const r = await Promise.race([exited, new Promise(res => { timer = setTimeout(() => res(null), 15000); })]);
      clearTimeout(timer);
      if (!r) {
        child.kill('SIGKILL');
        await exited;
      }
      if (!keepData) cleanUp();
      return r;
    },
  };
}
