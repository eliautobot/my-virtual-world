#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A companion sitting down beside its player, seen in a real browser (2026-11-17, the product owner: "if I'm in the park
// they can't sit down next to me on the bench"; server/sim/companion-moves.js seats, server/companions/ sit). On a
// throwaway server: the owner plays and walks up to a park bench, an agent comes along; the owner sits down on the bench
// (E, as anyone does), the agent is told 'sit' — the page must draw it sitting on the bench's other end (its place, a
// sitting clip), the Companions list say "Sitting with you on a bench"; 'stand' and it is up again. Screenshots:
// checks/companion-seat/ (not kept in the repository: /checks/ in .gitignore). The headless browser here may draw in
// software (slow): every step waits for its state, no timings. Usage: node tools/companion-seat-ui-check.mjs
// Exit 1 on a failure.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { WorldIndex } from '../server/sim/windex.js';
import { PlayerNav } from '../shared/playernav.js';
import { toWorld } from '../shared/geom.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), OUT = path.join(ROOT, 'checks', 'companion-seat');
const { startServer, ownerSession } = await import(path.join(ROOT, 'tools/lib/testserver.mjs'));
const { launch, gpuInfo } = createRequire(import.meta.url)(path.join(ROOT, 'tools/lib/browser.cjs'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PLAYER_APP = 12000;   // (client/js/render/agents.js: the page's own player's appearance slot)
const fails = [], check = (ok, what) => { console.log(`${ok ? '  ✓' : '  ✗'} ${what}`); if (!ok) fails.push(what); };
const waitFor = async (fn, ms = 60000, every = 500) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } };

const s = await startServer({ population: 200, agents: 2 });
let browser;
try {
  const owner = await ownerSession(s);
  await owner.post('/api/account/settings', { values: { 'display.guide': JSON.stringify({ tour: 'done', list: 'hidden' }) } });
  const world = (await owner.get('/api/world')).json.world, nav = new PlayerNav(world), idx = new WorldIndex(world);
  // a park bench a player can walk up to: its seats and where one stands to sit on its first
  let bench = null;
  for (const v of idx.venues.park) {
    const B = world.buildings[v.b];
    for (const [id, e] of idx.slots(B.lv[0])) {
      if (bench || e.it.t !== 'bench' || e.slots.length !== 2) continue;
      const [a, b] = e.slots.map(sl => toWorld(B, sl.lx, sl.lz)), ap = toWorld(B, e.slots[0].ax, e.slots[0].az);
      if (nav.ok(ap.x, ap.z, -1)) bench = { park: B.name, id, a, b, ap, yaw: Math.atan2(a.x - ap.x, a.z - ap.z) };
    }
  }
  check(!!bench, `a park bench (${bench?.park})`);
  if (!bench) throw new Error('no bench');
  const ag = (await owner.get('/api/agents')).json.agents, A = ag[0];
  browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage(), errs = [];
  page.setDefaultTimeout(60000);
  page.on('pageerror', e => errs.push(String(e).slice(0, 300)));
  console.log('GPU', await gpuInfo(page));
  await page.goto(`${s.url}/?q=high`, { waitUntil: 'load' });
  await page.evaluate(async p => fetch('/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'owner', password: p }) }), owner.password);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__mvw?.ready && window.__mvw.net?.plans && window.__mvw.player, null, { timeout: 300000, polling: 1000 });
  // (the people's characters downloaded and ready to draw: slow in a software-drawn browser)
  check(!!await page.waitForFunction(() => window.__mvw.agents?.chars?.loaded, null, { timeout: 600000, polling: 2000 }).then(() => true, () => false), 'the characters are loaded');
  await page.evaluate(() => window.__mvw.setMode?.('play'));
  check(!!await waitFor(() => page.evaluate(() => !!window.__mvw.player?.active), 60000), 'playing');
  // to the bench (an admin's warp), facing it; its agent comes along (the clock fast while it walks over)
  await page.evaluate(([x, z, yaw]) => window.__mvw.player.warp(x, z, -1, yaw), [bench.ap.x, bench.ap.z, bench.yaw]);
  check((await owner.post('/api/companions', { agent: A.id, action: 'follow', target: 'me' })).json.ok === true, `${A.name} follows the owner`);
  await owner.post('/api/clock', { rate: 10 });
  const near = await waitFor(async () => { const x = (await owner.get(`/api/agent/${A.i}`)).json; return Math.hypot(x.pos.x - bench.ap.x, x.pos.z - bench.ap.z) < 3.5 ? x : null; }, 240000, 1000);
  check(!!near, `${A.name} came to the bench`);
  await owner.post('/api/clock', { rate: 1 });
  // the owner sits down: E, as anyone does (the page's own seat and PF_USING)
  await waitFor(() => page.evaluate(() => window.__mvw.player.target?.k === 'slot'), 20000);
  await page.keyboard.press('e');
  const sat = await waitFor(() => page.evaluate(() => window.__mvw.player.state === 'use' && !window.__mvw.player.tween), 20000);
  check(!!sat, 'the owner sits on the bench');
  await sleep(1500);   // (the page tells the server it sits: its next state, ten a second)
  const r = (await owner.post('/api/companions', { agent: A.id, action: 'sit' })).json || {};
  check(r.ok === true, `told to sit: "${r.text || r.error}" — its brain: "${r.brain}"`);
  // the page draws it on the bench's other end, sitting
  const drawn = await waitFor(() => page.evaluate(([bx, bz, i]) => {
    const A = window.__mvw, ag = A.agents;
    return import('/js/render/anim.js').then(({ CLIP_NAMES }) => {
      const d = Math.hypot(ag.rx[i] - bx, ag.rz[i] - bz), clip = CLIP_NAMES[ag.clip[i]] || '';
      return d < 0.45 && /^sit/.test(clip) ? { d, clip } : null;
    });
  }, [bench.b.x, bench.b.z, A.i]), 60000, 700);
  check(!!drawn, `drawn sitting on the bench beside the owner (${drawn ? `${drawn.clip}, ${drawn.d.toFixed(2)} m from the seat` : 'no'})`);
  const list = await waitFor(async () => (await owner.get('/api/companions')).json.companions.find(c => c.agent === A.id && c.seat), 20000);
  check(list?.doing === 'Sitting with you on a bench', `the Companions list: "${list?.doing}"`);
  const bar = await waitFor(() => page.evaluate(id => document.querySelector(`.party-face[data-cm="${id}"] .pf-t small`)?.textContent || null, A.id).then(t => (t === 'Sitting with you on a bench' ? t : null)), 20000);
  check(!!bar, `the Companions bar on the page: "${bar}"`);
  // a view of the two on the bench, from in front of it (the camera held there: camera.js pinTo)
  const view = (front, up) => page.evaluate(([a, b, ap, front, up]) => {
    const A = window.__mvw, T = A.THREE, mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, y = A.player.y;
    const fx = ap.x - a.x, fz = ap.z - a.z, l = Math.hypot(fx, fz) || 1;
    A.cam.pinTo(new T.Vector3(mx + fx / l * front, y + up, mz + fz / l * front), new T.Vector3(mx, y + 0.6, mz));
  }, [bench.a, bench.b, bench.ap, front, up]);
  await view(3.6, 1.5);
  // (the two drawn with their own models, not waiting for them: each is downloaded when first seen)
  const own = await waitFor(() => page.evaluate(([i, p]) => { const C = window.__mvw.agents.chars; return !!C.kinds[C.kindOf[i]] && !!C.kinds[C.kindOf[p]]; }, [A.i, PLAYER_APP]), 300000, 2000);
  check(!!own, 'the two drawn with their own characters');
  await sleep(3000);
  await page.screenshot({ path: path.join(OUT, 'sitting-on-the-bench.png') });
  await view(1.2, 5.5);
  await sleep(3000);
  await page.screenshot({ path: path.join(OUT, 'sitting-from-above.png') });
  await view(3.6, 1.5);
  // 'stand': up again, beside the owner
  const st = (await owner.post('/api/companions', { agent: A.id, action: 'stand' })).json;
  check(st.ok === true, `told to stand: "${st.text}"`);
  const up = await waitFor(() => page.evaluate(i => import('/js/render/anim.js').then(({ CLIP_NAMES }) => !/^sit/.test(CLIP_NAMES[window.__mvw.agents.clip[i]] || 'sit')), A.i), 30000, 700);
  check(!!up, 'drawn standing again');
  await sleep(2000);
  await page.screenshot({ path: path.join(OUT, 'up-again.png') });
  await page.evaluate(() => window.__mvw.cam.unpin());
  check(errs.length === 0, `no page errors${errs.length ? `: ${errs.join(' | ')}` : ''}`);
} catch (e) { fails.push(e.message); console.error(e); } finally {
  try { await browser?.close(); } catch { /* closed */ }
  await s.stop();
}
console.log(fails.length ? `FAILED: ${fails.length}` : 'all passed', `— screenshots in ${path.relative(ROOT, OUT)}/`);
process.exit(fails.length ? 1 : 0);
