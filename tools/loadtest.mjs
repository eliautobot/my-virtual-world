#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Load test for the multiplayer core (PLAN WP1.10, I14.13): N simulated signed-in players on a throwaway server.
// 1. Starts a throwaway server on a copy of a data folder (or a generated city), with enough connections allowed.
// 2. Creates N accounts through the owner, signs each in and replaces its temporary password.
// 3. Measures the main loop with no players (baseline), then with N players walking about 10 moves a second each
//    around the spawn point (all within each other's full-rate area of interest: the worst case), and reports the
//    tick (simulation alone, and the whole loop with the player stream), the server's CPU and memory, and the bytes
//    each browser receives per second.
// 4. Optionally (--browser) opens a real browser as a guest looking at the crowd and records its frame rate.
// Nothing touches staging or live. Usage:
//   node tools/loadtest.mjs [--players 100] [--data <folder to copy>] [--seconds 30] [--browser] [--json <out.json>]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startServer, ownerSession, userSession, ROOT } from './lib/testserver.mjs';
import { PlayerNav } from '../shared/playernav.js';
import { decodePlayers } from '../shared/playerproto.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const N = Number(opt('players', 100)), SECONDS = Number(opt('seconds', 30)), DATA = opt('data', null), JSON_OUT = opt('json', null);
const BROWSER = args.includes('--browser');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function health(c) { return (await c.get('/api/health')).json; }
/** Samples the server over `secs`: the loop's tick distribution, the simulation's own tick, CPU and memory. */
async function sample(c, secs) {
  const h0 = await health(c), t0 = Date.now(), sim = [];
  const end = t0 + secs * 1000;
  while (Date.now() < end) { await sleep(1000); const h = await health(c); sim.push(h.players ? h : h); }
  const h1 = await health(c), wall = (Date.now() - t0) / 1000;
  const cpu = ((h1.loop.cpuUs.user + h1.loop.cpuUs.system) - (h0.loop.cpuUs.user + h0.loop.cpuUs.system)) / 1e6;
  return { seconds: Math.round(wall * 10) / 10, loop: h1.loop, cpuPercent: Math.round(cpu / wall * 1000) / 10, rssMb: h1.loop.rssMb, players: h1.players };
}

async function main() {
  log(`starting a throwaway server${DATA ? ` on a copy of ${DATA}` : ''}`);
  const s = await startServer({ copyFrom: DATA, population: DATA ? undefined : 2000, env: { MVW_WS_PER_ADDRESS: '5000', MVW_WS_MAX: '5000' }, timeoutMs: 90000 });
  let browser = null;
  const socks = [];
  try {
    const owner = await ownerSession(s);
    const world = (await owner.get('/api/world')).json.world, nav = new PlayerNav(world);
    log(`${world.buildings.filter(b => b && !b.gone).length} buildings; creating ${N} accounts`);
    const t0 = Date.now(), clients = [];
    for (let k = 0; k < N; k++) {
      clients.push(await userSession(s, owner, { login: `load${k}`, displayName: `Load Player ${k}`, role: 'member' }));
      if ((k + 1) % 25 === 0) log(`  ${k + 1} accounts`);
    }
    log(`accounts ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await sleep(1500);
    log(`baseline: ${SECONDS} s with no players`);
    const base = await sample(owner, SECONDS);
    log(`  loop mean ${base.loop.meanMs} ms · simulation ${base.loop.sim.meanMs} ms · p95 ${base.loop.p95Ms} ms · CPU ${base.cpuPercent} %`);
    // connect everyone, enter play mode, and walk around the spawn point
    const spawn = nav.defaultSpawn();
    for (const c of clients) {
      const ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: c.cookie } });
      ws.binaryType = 'arraybuffer';
      const b = { ws, me: null, bytes: 0, frames: 0, entries: 0, x: 0, z: 0, dir: Math.random() * Math.PI * 2, seq: 0, corr: 0 };
      ws.onmessage = e => {
        if (typeof e.data !== 'string') { b.bytes += e.data.byteLength; b.frames++; b.entries += decodePlayers(e.data, () => {}); return; }
        b.bytes += e.data.length;
        const m = JSON.parse(e.data);
        if (m.t === 'you') { b.me = m; b.x = m.x; b.z = m.z; }
        else if (m.t === 'pcorr') { b.corr++; b.x = m.x; b.z = m.z; }
      };
      socks.push(b);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws failed')); });
    }
    await sleep(1500);
    for (const b of socks) b.ws.send(JSON.stringify({ t: 'pobserve', on: false }));
    log(`${socks.filter(b => b.me).length} of ${N} players in the world; walking for ${SECONDS} s`);
    let walking = true;
    const walker = (async () => {
      while (walking) {
        const t = Date.now();
        for (const b of socks) {
          if (!b.me) continue;
          for (let tries = 0; tries < 4; tries++) {
            const nx = b.x + Math.cos(b.dir) * 0.3, nz = b.z + Math.sin(b.dir) * 0.3;
            if (Math.hypot(nx - spawn.x, nz - spawn.z) < 28 && nav.ok(nx, nz, -1)) { b.x = nx; b.z = nz; break; }
            b.dir += Math.PI * (0.5 + Math.random());
          }
          if (Math.random() < 0.05) b.dir += (Math.random() - 0.5) * 1.5;
          b.ws.send(JSON.stringify({ t: 'pmove', x: b.x, y: 0.15, z: b.z, yaw: b.dir, ctx: -1, clip: 1, flags: 0, seq: ++b.seq & 65535 }));
        }
        await sleep(Math.max(0, 100 - (Date.now() - t)));
      }
    })();
    await sleep(2000);
    for (const b of socks) { b.bytes = 0; b.frames = 0; b.entries = 0; }
    const tW = Date.now();
    let fps = null;
    if (BROWSER) {
      const require = createRequire(import.meta.url);
      const { launch, gpuInfo, isSoftware } = require(path.join(ROOT, 'tools/lib/browser.cjs'));
      browser = await launch();
      const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e.message)));
      await page.goto(`${s.url}/?hour=12&cam=${spawn.x.toFixed(1)},${spawn.z.toFixed(1)},60`, { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(() => window.__mvw && window.__mvw.ready, null, { timeout: 60000 });
      await page.waitForFunction(n => window.__mvw.remote && window.__mvw.remote.drawn.length >= n * 0.9, N, { timeout: 30000 }).catch(() => {});
      await sleep(3000);
      const samples = [];
      for (let k = 0; k < 8; k++) { await sleep(1000); samples.push(await page.evaluate(() => ({ fps: __mvw.fps, drawn: __mvw.remote.drawn.length, cpu: __mvw.cpuMs }))); }
      const g = await gpuInfo(page);
      samples.sort((a, b) => a.fps - b.fps);
      fps = { median: Math.round(samples[4].fps * 10) / 10, min: Math.round(samples[0].fps * 10) / 10, remoteDrawn: samples[4].drawn,
        cpuMsPerFrame: Math.round(samples[4].cpu * 100) / 100, gpu: g, software: isSoftware(g), pageErrors: errors.slice(0, 5) };
      await page.screenshot({ path: '/tmp/loadtest-crowd.png' });
      log(`  browser: ${fps.median} fps (min ${fps.min}) with ${fps.remoteDrawn} remote players drawn, ${fps.software ? 'SOFTWARE rendering' : 'GPU'}`);
    }
    const load = await sample(owner, Math.max(5, SECONDS - (BROWSER ? 12 : 0)));
    const secs = (Date.now() - tW) / 1000;
    walking = false; await walker;
    const kbps = socks.map(b => b.bytes / secs / 1024).sort((a, b) => a - b);
    const rate = socks.map(b => b.entries / secs).sort((a, b) => a - b);
    const med = a => a[Math.floor(a.length / 2)];
    const corr = socks.reduce((n, b) => n + b.corr, 0);
    const r = {
      tool: 'tools/loadtest.mjs', at: new Date().toISOString(), players: N, seconds: SECONDS, data: DATA ? path.basename(DATA) : 'generated',
      baseline: base, load,
      perClient: { kbPerSecMedian: Math.round(med(kbps) * 10) / 10, kbPerSecMax: Math.round(kbps[kbps.length - 1] * 10) / 10,
        playerUpdatesPerSecMedian: Math.round(med(rate)), corrections: corr },
      // I14.13: the simulation's own tick stays within +10 % of its baseline; the player stream is new work, reported apart
      simTickIncreasePercent: base.loop.sim.meanMs > 0 ? Math.round((load.loop.sim.meanMs / base.loop.sim.meanMs - 1) * 1000) / 10 : null,
      loopIncreasePercent: base.loop.meanMs > 0 ? Math.round((load.loop.meanMs / base.loop.meanMs - 1) * 1000) / 10 : null,
      loopShareOfTickPercent: Math.round(load.loop.meanMs / 100 * 1000) / 10,
      browser: fps,
    };
    log(`with ${N} players: loop mean ${load.loop.meanMs} ms · p95 ${load.loop.p95Ms} ms · max ${load.loop.maxMs} ms (of a 100 ms tick) · CPU ${load.cpuPercent} %`);
    log(`  simulation ${load.loop.sim.meanMs} ms (baseline ${base.loop.sim.meanMs}, ${r.simTickIncreasePercent} %) · player stream ${load.loop.stream.meanMs} ms mean, p95 ${load.loop.stream.p95Ms} ms`);
    log(`per browser: ${r.perClient.kbPerSecMedian} KB/s median (max ${r.perClient.kbPerSecMax}), ${r.perClient.playerUpdatesPerSecMedian} player updates/s; ${corr} corrections`);
    if (JSON_OUT) { fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true }); fs.writeFileSync(JSON_OUT, JSON.stringify(r, null, 2) + '\n'); log(`report: ${JSON_OUT}`); }
    return r;
  } finally {
    for (const b of socks) { try { b.ws.close(); } catch { /* */ } }
    if (browser) await browser.close().catch(() => {});
    await s.stop();
  }
}
main().then(() => process.exit(0), e => { console.error('load test failed:', e.stack || e.message); process.exit(1); });
