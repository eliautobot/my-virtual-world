// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Real-GPU rendering performance at fixed cameras, for each quality preset. It only views the world: no edits, and the
// server clock is changed only on its own throwaway server. By default it starts that throwaway server itself.
// For each preset it loads the app on a weekday afternoon and measures four camera views (whole city, downtown, street
// level, the busiest HQ floor), then reloads at night for a fifth. Per view:
//   rafFps     the app's own frame counter while it runs normally. Headless Chrome paces frames itself, so this is
//              capped below the display rate and is not the limit of the GPU.
//   frameMs    one full frame with the display cap removed: app.step() plus a 1-pixel read-back that waits for the GPU
//              to finish. CPU and GPU work run one after the other here, so a real display can do slightly better.
//   fps        1000 / frameMs (p50 and p95)
//   cpuMs      app.step() alone (JavaScript and WebGL command submission)
//   calls, triangles, residents drawn, geometries, textures, JS heap
// X4 (CHECKLIST): high quality holds >= 55 fps, taken here as fps p95 >= 55 in every view.
// Usage: node tools/perf.cjs [--url <base> | --data <data folder to copy>] [--root <code folder>] [--population n]
//          [--size 1920x1080] [--dpr 1] [--frames 150] [--quality low,medium,high] [--json <out.json>] [--shots <dir>]
//          [--require-x4]
// Browser: tools/lib/browser.cjs (Chrome channel or MVW_TEST_BROWSER; sandbox on; no security-weakening flags).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs } = require('node:util');
const { launch, gpuInfo, isSoftware } = require('./lib/browser.cjs');

const ROOT = path.resolve(__dirname, '..');
const X4_FPS = 55;
const r2 = v => Math.round(v * 100) / 100;
function stats(arr) {
  const s = Float64Array.from(arr).sort();
  const q = p => s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))];
  let sum = 0;
  for (const v of s) sum += v;
  return { mean: r2(sum / s.length), p50: r2(q(0.5)), p95: r2(q(0.95)), max: r2(s[s.length - 1]) };
}

// Runs in the page: times frames without the display cap.
async function measure({ frames, warm }) {
  const A = window.__mvw, r = A.stage.renderer;
  const base = {
    rafFps: Math.round(A.fps * 10) / 10, q: A.stage.q.name, night: Math.round(A.stage.state.night * 100) / 100,
    focus: A.S.focus.b >= 0 ? `${A.S.focus.b},${A.S.focus.f}` : null,
  };
  if (typeof A.step !== 'function') return { ...base, frame: null };
  const gl = r.getContext(), px = new Uint8Array(4);
  A.hold = true;
  await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
  const sync = () => { r.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  try {
    for (let k = 0; k < warm; k++) { A.step(performance.now()); sync(); }
    const frame = [], cpu = [];
    let calls = 0, tris = 0, drawn = 0;
    for (let k = 0; k < frames; k++) {
      const t0 = performance.now();
      A.step(t0);
      const t1 = performance.now();
      sync();
      frame.push(performance.now() - t0);
      cpu.push(t1 - t0);
      calls += r.info.render.calls; tris += r.info.render.triangles; drawn += A.agents.nDrawn;
    }
    const mem = performance.memory;
    return {
      ...base, frame, cpu, calls: Math.round(calls / frames), triangles: Math.round(tris / frames), residentsDrawn: Math.round(drawn / frames),
      geometries: r.info.memory.geometries, textures: r.info.memory.textures, heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
    };
  } finally {
    A.hold = false;
  }
}

(async () => {
  let o;
  try {
    ({ values: o } = parseArgs({ options: {
      url: { type: 'string' }, data: { type: 'string' }, root: { type: 'string' }, population: { type: 'string', default: '4000' },
      size: { type: 'string', default: '1920x1080' }, dpr: { type: 'string', default: '1' }, frames: { type: 'string', default: '150' },
      quality: { type: 'string', default: 'low,medium,high' }, json: { type: 'string' }, shots: { type: 'string' },
      'require-x4': { type: 'boolean', default: false },
    } }));
  } catch (e) { console.error(e.message); process.exit(2); }
  const [vw, vh] = o.size.split('x').map(Number), dpr = +o.dpr, frames = Math.max(20, +o.frames | 0);
  const presets = o.quality.split(',').map(s => s.trim()).filter(Boolean);
  if (!(vw > 0 && vh > 0 && dpr > 0) || presets.some(q => !['low', 'medium', 'high'].includes(q))) {
    console.error('usage: node tools/perf.cjs [--url <base> | --data <folder>] [--size WxH] [--dpr n] [--frames n] [--quality low,medium,high] [--json out] [--shots dir] [--require-x4]');
    process.exit(2);
  }
  if (o.shots) fs.mkdirSync(o.shots, { recursive: true });

  let server = null, base = o.url || null;
  if (!base) {
    const { startServer, ownerSession } = await import('./lib/testserver.mjs');
    server = await startServer({
      root: o.root ? path.resolve(o.root) : undefined, copyFrom: o.data ? path.resolve(o.data) : null,
      population: +o.population || 4000, timeoutMs: 60000,
    });
    base = server.url;
    const owner = await ownerSession(server);   // changing the clock needs an admin; this is the throwaway server's owner
    for (let k = 0; k < 4; k++) {       // the next weekday at 14:00, so residents are at work and on the streets
      const c = (await owner.post('/api/clock', { skip: 14 })).json;
      if (!['Sat', 'Sun'].includes(c.weekday)) break;
    }
    console.log(`throwaway server ${base} (${o.data ? 'world copied from ' + o.data : 'new city'})`);
  }
  const health = await (await fetch(new URL('/api/health', base))).json();
  const clock = await (await fetch(new URL('/api/clock', base))).json();
  const W = (await (await fetch(new URL('/api/world', base))).json()).world;
  const hq = W.buildings.find(b => b && !b.gone && b.type === 'hq');
  const { makeGrid } = await import('../shared/city.js');
  const g = makeGrid(W.grid);
  const cx = (g.minX + g.maxX) / 2, cz = (g.minZ + g.maxZ) / 2, span = Math.max(g.maxX - g.minX, g.maxZ - g.minZ);
  const dayViews = [
    { name: 'city', desc: 'the whole city from above', cam: [cx, cz, Math.min(900, span * 0.95), 0.7, 0.95] },
    { name: 'downtown', desc: 'the blocks around HQ', cam: [hq.x, hq.z, 160, 0.55, 0.8] },
    { name: 'street', desc: 'street level in front of HQ', cam: [hq.x, hq.z + hq.d / 2 + 12, 30, 0.35, 0.28] },
    { name: 'interior', desc: 'the busiest HQ floor', inside: hq.idx },
  ];
  const nightView = { name: 'night', desc: 'downtown at 9:30 PM', cam: [hq.x - 40, hq.z - 20, 260, 0.8, 0.8] };
  const fmt = v => v.map(n => Math.round(n * 100) / 100).join(',');

  const browser = await launch();
  const results = [], errors = [];
  let gpu = '';
  try {
    for (const q of presets) {
      for (const pass of [{ hour: 14, views: dayViews }, { hour: 21.5, views: [nightView] }]) {
        const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr });
        const p = await ctx.newPage();
        p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(`[${q}] ${m.text().slice(0, 300)}`); });
        p.on('pageerror', e => errors.push(`[${q}] [pageerror] ${(e.stack || e.message).slice(0, 400)}`));
        const first = pass.views[0];
        await p.goto(`${base}/?q=${q}&hour=${pass.hour}&cam=${fmt(first.cam)}`, { waitUntil: 'load', timeout: 30000 });
        if (!gpu) gpu = await gpuInfo(p);
        const ready = await p.waitForFunction(() => window.__mvw && window.__mvw.ready, null, { timeout: 30000 }).then(() => true, () => false);
        if (!ready) { errors.push(`[${q}] the app did not become ready`); await ctx.close(); continue; }
        await p.waitForTimeout(5000);
        for (const v of pass.views) {
          if (v !== first) {
            if (v.inside !== undefined) {
              await p.evaluate(b => {
                const A = window.__mvw, cnt = {};
                for (let i = 0; i < A.S.people.length; i++) { const c = A.agents.ctx[i]; if (c >= 0 && (c >> 6) === b) cnt[c & 63] = (cnt[c & 63] || 0) + 1; }
                let f = 0, n = -1;
                for (const k of Object.keys(cnt)) if (cnt[k] > n) { n = cnt[k]; f = +k; }
                A.lookInside(b, f);
              }, v.inside);
              await p.waitForTimeout(3000);
            } else {
              await p.evaluate(c => {
                const A = window.__mvw;
                if (A.S.focus.b >= 0) A.exitFocus();
                A.cam.jumpTo(c[0], 0, c[1], c[2]);
                A.cam.yaw = A.cam.goalYaw = c[3];
                A.cam.pitch = A.cam.goalPitch = c[4];
              }, v.cam);
              await p.waitForTimeout(2500);
            }
          } else await p.waitForTimeout(500);
          const m = await p.evaluate(measure, { frames, warm: 20 });
          const row = { quality: q, view: v.name, desc: v.desc, hour: pass.hour, rafFps: m.rafFps, focus: m.focus, night: m.night };
          if (m.frame) {
            const fr = stats(m.frame), cpu = stats(m.cpu);
            Object.assign(row, {
              frameMs: fr, cpuMs: { mean: cpu.mean, p95: cpu.p95 }, fps: { p50: r2(1000 / fr.p50), p95: r2(1000 / fr.p95) },
              calls: m.calls, triangles: m.triangles, residentsDrawn: m.residentsDrawn, geometries: m.geometries, textures: m.textures, heapMB: m.heapMB,
            });
          } else row.frameMs = null;
          if (m.q !== q) errors.push(`[${q}] ${v.name}: the page ran quality "${m.q}"`);
          results.push(row);
          const f = row.frameMs;
          console.log(`${q.padEnd(6)} ${v.name.padEnd(8)} raf ${String(row.rafFps).padStart(5)} fps | ${f ? `frame p50 ${f.p50.toFixed(2)} p95 ${f.p95.toFixed(2)} ms = ${row.fps.p50.toFixed(0)} / ${row.fps.p95.toFixed(0)} fps | cpu ${row.cpuMs.mean.toFixed(2)} ms | ${row.calls} calls, ${(row.triangles / 1e6).toFixed(2)} M tris, ${row.residentsDrawn} residents` : 'frame timing unavailable (this app version has no step hook)'}`);
          if (o.shots) { await p.waitForTimeout(400); await p.screenshot({ path: path.join(o.shots, `${q}-${v.name}.png`) }); }
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    if (server) await server.stop();
  }

  const high = results.filter(r => r.quality === 'high' && r.fps);
  const worst = high.length ? Math.min(...high.map(r => r.fps.p95)) : null;
  const x4 = { threshold: X4_FPS, measured: high.length > 0, worstHighFpsP95: worst, pass: high.length === 5 && worst >= X4_FPS };
  let commit = null;
  try {
    const git = a => execFileSync('git', a, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).toString().trim();
    commit = git(['rev-parse', '--short', 'HEAD']) + (git(['status', '--porcelain', '--untracked-files=no']) ? '-dirty' : '');
  } catch { /* not a git checkout */ }
  const errs = [...new Set(errors)];
  console.log(`\nGPU: ${gpu}${isSoftware(gpu) ? '  (software rendering: these numbers say nothing about the GPU)' : ''}`);
  console.log(`X4 (high quality >= ${X4_FPS} fps p95 in every view): ${x4.pass ? 'PASS' : 'FAIL'}${worst !== null ? `, worst ${worst} fps` : ''}`);
  console.log(errs.length ? 'Console errors:\n' + errs.slice(0, 20).join('\n') : 'No console errors');
  if (o.json) {
    fs.mkdirSync(path.dirname(path.resolve(o.json)), { recursive: true });
    fs.writeFileSync(o.json, JSON.stringify({
      tool: 'perf', at: new Date().toISOString(), commit, server: server ? 'throwaway' : base, data: o.data || null,
      serverVersion: health.version, release: health.release, residents: health.agents, worldClock: `${clock.weekday} ${clock.hour.toFixed(2)}`,
      gpu, software: isSoftware(gpu), size: `${vw}x${vh}`, dpr, frames, x4, consoleErrors: errs, results,
    }, null, 2) + '\n');
    console.log(`saved ${o.json}`);
  }
  process.exit(errs.length || results.length === 0 || (o['require-x4'] && !x4.pass) ? 1 : 0);
})().catch(e => { console.error('PERF ERR', e.stack || e.message); process.exit(1); });
