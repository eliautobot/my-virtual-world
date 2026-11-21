#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see
// LICENSE).
// A companion sitting down beside its player on a bench placed on open land, seen in a real browser (2026-11-17, the
// product owner: "they have to be aware of all objects whether or not they are considered decorations — that includes
// docks or any other place"; server/sim/decor-seats.js, server/interactions/sources/decor.js). On a throwaway server: an
// administrator places a bench just past the city's streets; the owner plays and walks up to it, an agent comes along;
// the owner sits down on it (E, as anyone does: the page's decorNear), the agent is told through the interaction
// registry (what its decision model chooses from: 'body:sit') — the page must draw it sitting on the bench's other end
// (its place, a sitting clip, at the owner's height), the Companions list say "Sitting with you on a bench by «…»"; the
// owner gets up and walks off — it is drawn standing and coming along. Screenshots: checks/decor-seat/ (not kept in the
// repository: /checks/ in .gitignore). The headless browser here may draw in software (slow): every step waits for its
// state, no timings. Usage: node tools/decor-seat-check.mjs   Exit 1 on a failure.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PlayerNav } from '../shared/playernav.js';
import { CATALOG } from '../shared/catalog.js';
import { makeGrid } from '../shared/city.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), OUT = path.join(ROOT, 'checks', 'decor-seat');
const { startServer, ownerSession } = await import(path.join(ROOT, 'tools/lib/testserver.mjs'));
const { launch, gpuInfo } = createRequire(import.meta.url)(path.join(ROOT, 'tools/lib/browser.cjs'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PLAYER_APP = 12000;   // (client/js/render/agents.js: the page's own player's appearance slot)
const fails = [], check = (ok, what) => { console.log(`${ok ? '  ✓' : '  ✗'} ${what}`); if (!ok) fails.push(what); };
const waitFor = async (fn, ms = 60000, every = 500) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } };
/** A slot's world place (the decoration is its own frame: client/js/player/player.js findTarget). */
const slotAt = (d, sl) => { const c = Math.cos(d.r), s = Math.sin(d.r); return { x: d.x + sl.x * c + sl.z * s, z: d.z - sl.x * s + sl.z * c }; };

const s = await startServer({ population: 200, agents: 2 });
let browser;
try {
  const owner = await ownerSession(s);
  await owner.post('/api/account/settings', { values: { 'display.guide': JSON.stringify({ tour: 'done', list: 'hidden' }) } });
  // a bench just past the city's streets, on open ground (the server's own rules place it)
  let world = (await owner.get('/api/world')).json.world;
  const g = makeGrid(world.grid), nav = new PlayerNav(world), R = CATALOG.bench.rect;
  let bench = null;
  for (let k = 0; k < 40 && !bench; k++) {
    const d = { t: 'bench', x: Math.round((g.maxX + 14) * 100) / 100, z: Math.round((g.minZ + 20 + k * ((g.maxZ - g.minZ - 40) / 40)) * 100) / 100, r: 0 };
    if (![[0, 0], [R[0], R[1]], [R[2], R[3]], [-0.5, 0.85], [0.5, 0.85], [0, 3]].every(([dx, dz]) => nav.ok(d.x + dx, d.z + dz, -1))) continue;
    const r = await owner.post('/api/edit', { ops: [{ op: 'deco.add', deco: d }] });
    if (r.status === 200) bench = { ...d, id: r.json.results[0].id };
  }
  check(!!bench, `a bench placed on open land (${bench?.id} at ${bench?.x}, ${bench?.z})`);
  if (!bench) throw new Error('no bench');
  const [a, b] = CATALOG.bench.slots.map(sl => slotAt(bench, sl)), ap = slotAt(bench, { x: -0.5, z: 0.85 });
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
  check(!!await page.waitForFunction(() => window.__mvw.agents?.chars?.loaded, null, { timeout: 600000, polling: 2000 }).then(() => true, () => false), 'the characters are loaded');
  await page.evaluate(() => window.__mvw.setMode?.('play'));
  check(!!await waitFor(() => page.evaluate(() => !!window.__mvw.player?.active), 60000), 'playing');
  // the page has the bench (the decorations' own patch)
  check(!!await waitFor(() => page.evaluate(id => (window.__mvw.S?.world || window.__mvw.world)?.decorations?.some(d => d.id === id) ?? true, bench.id), 30000), 'the page has the bench');
  // to the bench (an admin's warp), facing it; its agent comes along (the clock fast while it walks over)
  await page.evaluate(([x, z, yaw]) => window.__mvw.player.warp(x, z, -1, yaw), [ap.x, ap.z, Math.atan2(a.x - ap.x, a.z - ap.z)]);
  check((await owner.post('/api/companions', { agent: A.id, action: 'follow', target: 'me' })).json.ok === true, `${A.name} follows the owner`);
  await owner.post('/api/clock', { rate: 10 });
  const near = await waitFor(async () => { const x = (await owner.get(`/api/agent/${A.i}`)).json; return Math.hypot(x.pos.x - ap.x, x.pos.z - ap.z) < 3.5 ? x : null; }, 240000, 1000);
  check(!!near, `${A.name} came to the bench`);
  await owner.post('/api/clock', { rate: 1 });
  // the owner sits down: E, as anyone does (the page's decorNear seat and PF_USING)
  await waitFor(() => page.evaluate(() => window.__mvw.player.target?.k === 'slot'), 20000);
  await page.keyboard.press('e');
  const sat = await waitFor(() => page.evaluate(() => window.__mvw.player.state === 'use' && !window.__mvw.player.tween), 20000);
  check(!!sat, 'the owner sits on the bench');
  await sleep(1500);   // (the page tells the server it sits: its next state, ten a second)
  // what the agent can do now (its decision model's options): sitting down with them there first — told to, it does
  const things = (await owner.get(`/api/interactions?agent=${A.id}`)).json.things || [];
  check(things[0]?.id === 'body:sit' && /they are sitting on a bench by «.+»/.test(things[0].label), `first of what it can do: "${things[0]?.label}"`);
  const r = (await owner.post('/api/interactions', { agent: A.id, id: 'body:sit' })).json || {};
  check(r.ok === true, `it sits down: "${r.text}" — its brain: "${r.brain}"`);
  // the page draws it on the bench's other end, sitting, at the owner's height
  const drawn = await waitFor(() => page.evaluate(([bx, bz, i]) => {
    const M = window.__mvw, ag = M.agents;
    return import('/js/render/anim.js').then(({ CLIP_NAMES }) => {
      const d = Math.hypot(ag.rx[i] - bx, ag.rz[i] - bz), clip = CLIP_NAMES[ag.clip[i]] || '', dy = ag.ry[i] - M.player.y;
      return d < 0.45 && /^sit/.test(clip) && Math.abs(dy) < 0.2 ? { d, clip, dy } : null;
    });
  }, [b.x, b.z, A.i]), 60000, 700);
  check(!!drawn, `drawn sitting on the bench beside the owner (${drawn ? `${drawn.clip}, ${drawn.d.toFixed(2)} m from the seat, ${drawn.dy.toFixed(2)} m from the owner's height` : 'no'})`);
  const list = await waitFor(async () => (await owner.get('/api/companions')).json.companions.find(c => c.agent === A.id && c.seat), 20000);
  check(/^Sitting with you on a bench by «.+»$/.test(list?.doing || ''), `the Companions list: "${list?.doing}"`);
  // a view of the two on the bench, from in front of it (the camera held there: camera.js pinTo)
  const view = (front, up) => page.evaluate(([a, b, ap, front, up]) => {
    const M = window.__mvw, T = M.THREE, mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, y = M.player.y;
    const fx = ap.x - a.x, fz = ap.z - a.z, l = Math.hypot(fx, fz) || 1;
    M.cam.pinTo(new T.Vector3(mx + fx / l * front, y + up, mz + fz / l * front), new T.Vector3(mx, y + 0.6, mz));
  }, [a, b, ap, front, up]);
  await view(3.6, 1.5);
  const own = await waitFor(() => page.evaluate(([i, p]) => { const C = window.__mvw.agents.chars; return !!C.kinds[C.kindOf[i]] && !!C.kinds[C.kindOf[p]]; }, [A.i, PLAYER_APP]), 300000, 2000);
  check(!!own, 'the two drawn with their own characters');
  await sleep(3000);
  await page.screenshot({ path: path.join(OUT, 'sitting-on-the-open-land-bench.png') });
  await view(1.2, 5.5);
  await sleep(3000);
  await page.screenshot({ path: path.join(OUT, 'sitting-from-above.png') });
  await page.evaluate(() => window.__mvw.cam.unpin());
  // the owner gets up (E) and walks off: it is up and coming along
  await page.keyboard.press('e');
  await waitFor(() => page.evaluate(() => window.__mvw.player.state === 'walk' && !window.__mvw.player.tween), 20000);
  await page.evaluate(([x, z]) => window.__mvw.player.warp(x, z, -1, 0), [ap.x - 7, ap.z + 5]);
  const up = await waitFor(() => page.evaluate(i => import('/js/render/anim.js').then(({ CLIP_NAMES }) => !/^sit/.test(CLIP_NAMES[window.__mvw.agents.clip[i]] || 'sit')), A.i), 30000, 700);
  check(!!up, 'drawn standing again once the owner walked off');
  const along = await waitFor(async () => { const x = (await owner.get(`/api/agent/${A.i}`)).json; return Math.hypot(x.pos.x - (ap.x - 7), x.pos.z - (ap.z + 5)) < 4 ? x : null; }, 30000, 700);
  check(!!along, 'and came along');
  await sleep(2000);
  await page.screenshot({ path: path.join(OUT, 'up-and-along.png') });
  check(errs.length === 0, `no page errors${errs.length ? `: ${errs.join(' | ')}` : ''}`);
} catch (e) { fails.push(e.message); console.error(e); } finally {
  try { await browser?.close(); } catch { /* closed */ }
  await s.stop();
}
console.log(fails.length ? `FAILED: ${fails.length}` : 'all passed', `— screenshots in ${path.relative(ROOT, OUT)}/`);
process.exit(fails.length ? 1 : 0);
