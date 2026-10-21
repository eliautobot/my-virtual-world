// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Smoke checks for a running My Virtual World Next server. Used by tools/smoke.mjs, the deploy scripts and the tests.
// Read-only: GET requests and one WebSocket connection; it never changes the world.
import fs from 'node:fs';
import path from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Counts in a data folder: buildings still standing, residents, world version. */
export function countData(dataDir) {
  const read = f => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
  const world = read('world.json');
  const people = read('people.json');
  return {
    buildings: (world.buildings || []).filter(b => b && !b.gone).length,
    people: Array.isArray(people) ? people.length : 0,
    worldVersion: world.version || 0,
  };
}

/** Polls /api/health until the server answers ok, or throws after timeoutMs. */
export async function waitForHealth(base, timeoutMs = 60000) {
  const until = Date.now() + timeoutMs;
  let last = 'no answer';
  while (Date.now() < until) {
    try {
      const res = await fetch(new URL('/api/health', base), { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const h = await res.json();
        if (h && h.ok === true) return h;
        last = 'health is not ok';
      } else last = `HTTP ${res.status}`;
    } catch (e) {
      last = e.cause?.code || e.name || String(e);
    }
    await sleep(250);
  }
  throw new Error(`no healthy answer from ${base} within ${Math.round(timeoutMs / 1000)} s (${last})`);
}

/** Opens the world WebSocket and resolves with the first text message: the server's hello, or { t: 'auth' } when
 *  watching needs sign-in (the server then closes the stream with code 4401). */
function wsHello(base, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const u = new URL('/ws', base);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(u);
    const close = () => { try { ws.close(); } catch { /* already closed */ } };
    const timer = setTimeout(() => { close(); reject(new Error(`no hello within ${timeoutMs} ms`)); }, timeoutMs);
    ws.addEventListener('message', ev => {
      if (typeof ev.data !== 'string') return;
      clearTimeout(timer);
      try { resolve(JSON.parse(ev.data)); } catch (e) { reject(e); } finally { close(); }
    });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket error')); });
  });
}

/**
 * Runs every smoke check against a server.
 * @param {object} o
 * @param {string} o.url         base URL, e.g. http://127.0.0.1:8570
 * @param {string} [o.expectTag] release tag the server must report
 * @param {{buildings:number, people:number, worldVersion?:number}} [o.expect] saved counts: buildings must match,
 *        residents must not be fewer (new agents may join at start-up), the world version must not go back
 * @param {number} [o.timeoutMs] how long to wait for the server to become healthy
 * @returns {Promise<{ok:boolean, checks:{name:string, ok:boolean, detail:string}[], health:object|null}>}
 */
export async function smoke({ url, expectTag = null, expect = null, timeoutMs = 60000 }) {
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });
  const result = health => ({ ok: checks.length > 0 && checks.every(c => c.ok), checks, health });

  let health;
  try {
    health = await waitForHealth(url, timeoutMs);
    const rel = health.release ? `, ${health.release.channel}${health.release.tag ? ' ' + health.release.tag : ''}` : '';
    add('health', true, `server ${health.version}${rel}`);
  } catch (e) {
    add('health', false, e.message);
    return result(null);
  }
  if (expectTag) {
    if (health.release) add('release', health.release.tag === expectTag, `running ${health.release.tag || health.release.channel}, expected ${expectTag}`);
    else add('release', true, 'server predates release info; the deploy scripts check the process folder instead');
  }
  add('server errors', !health.errors, `${health.errors || 0} errors`);

  try {
    const res = await fetch(new URL('/', url), { signal: AbortSignal.timeout(15000) });
    const html = await res.text();
    add('page', res.ok && html.includes('importmap') && html.includes('/js/main.js'), `HTTP ${res.status}, ${html.length} bytes`);
  } catch (e) { add('page', false, e.message); }
  for (const [name, p, min] of [['main.js', '/js/main.js', 1000], ['three.js', '/vendor/three/build/three.module.js', 100000]]) {
    try {
      const res = await fetch(new URL(p, url), { signal: AbortSignal.timeout(15000) });
      const body = await res.arrayBuffer();
      add(name, res.ok && body.byteLength >= min, `HTTP ${res.status}, ${body.byteLength} bytes`);
    } catch (e) { add(name, false, e.message); }
  }

  // When watching needs sign-in, /api/world answers 401; the public health figures (buildings, world version) stand in.
  let signInToWatch = false;
  try {
    const res = await fetch(new URL('/api/world', url), { signal: AbortSignal.timeout(30000) });
    let buildings, version;
    if (res.status === 401 && Number.isFinite(health.buildings)) {
      signInToWatch = true;
      buildings = health.buildings;
      version = health.worldVersion;
      add('world', true, 'watching needs sign-in; counts from /api/health');
    } else {
      const j = await res.json();
      buildings = (j.world?.buildings || []).filter(b => b && !b.gone).length;
      version = j.version;
    }
    if (expect) add('buildings', buildings === expect.buildings, `${buildings} standing (saved: ${expect.buildings})`);
    else add('buildings', buildings > 0, `${buildings} standing`);
    if (expect && Number.isFinite(expect.worldVersion)) {
      add('world version', (version || 0) >= expect.worldVersion, `${version} (saved: ${expect.worldVersion})`);
    }
  } catch (e) { add('world', false, e.message); }

  if (expect) add('population', health.agents >= expect.people, `${health.agents} residents (saved: ${expect.people})`);
  else add('population', health.agents > 0, `${health.agents} residents`);

  try {
    const hello = await wsHello(url);
    if (signInToWatch) add('websocket', hello.t === 'auth' && hello.state === 'signin_required', `${hello.t} ${hello.state || ''}: the stream asks guests to sign in`);
    else add('websocket', hello.t === 'hello' && hello.count === health.agents, `${hello.t}, ${hello.count} residents`);
  } catch (e) { add('websocket', false, e.message); }

  return result(health);
}
