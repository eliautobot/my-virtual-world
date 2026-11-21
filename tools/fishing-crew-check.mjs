#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A companion fishing with its owner, seen in a real browser (server/play/fishing-crew.js, render/boat-crew.js). On a
// throwaway server with an island and a marina: the owner plays, their agent follows; the owner takes a boat from its
// slip — the agent walks down the pier and gets on, drawn at its fishing spot on the deck; the owner starts a trip — the
// agent fishes too (rod out, casting, waiting, fighting), and its catch comes to the owner's page as a toast; the owner
// steps off at the dock — the agent gets off with them. Screenshots: checks/fishing-crew/ (not kept in the repository).
// The headless browser here is slow (software rendering): every step waits for its state, no tight timings.
// Usage: node tools/fishing-crew-check.mjs   (exit 1 on a failure)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), OUT = path.join(ROOT, 'checks', 'fishing-crew');
const { startServer, ownerSession, tempDir } = await import(path.join(ROOT, 'tools/lib/testserver.mjs'));
const { launch } = createRequire(import.meta.url)(path.join(ROOT, 'tools/lib/browser.cjs'));
const { Island } = await import(path.join(ROOT, 'shared/terrain.js'));
const { RoadNetwork } = await import(path.join(ROOT, 'shared/roads.js'));
const { checkWorldModule, boatSlips } = await import(path.join(ROOT, 'shared/world-modules.js'));
const { fitToShore, DOCKS } = await import(path.join(ROOT, 'shared/dock-layout.js'));
const { coastline, protectedWhy } = await import(path.join(ROOT, 'shared/coasts.js'));
const { buildingPads } = await import(path.join(ROOT, 'shared/island-build.js'));
const { toWorldAt } = await import(path.join(ROOT, 'shared/airport-layout.js'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [], check = (ok, what) => { console.log(`${ok ? '  ✓' : '  ✗'} ${what}`); if (!ok) fails.push(what); };
const waitFor = async (fn, ms = 30000, every = 400) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } };

const dir = tempDir('mvw-fishcrew-');
await (await startServer({ data: dir, population: 160, agents: 1 })).stop({ keepData: true });
for (const tool of ['add-island', 'add-roads']) { const r = spawnSync(process.execPath, [`tools/wp4/${tool}.mjs`, '--data', dir, '--server-stopped'], { cwd: ROOT, encoding: 'utf8' }); if (r.status) throw new Error(r.stderr); }
const s = await startServer({ data: dir, population: 160 });
let browser;
try {
  const owner = await ownerSession(s);
  await owner.post('/api/account/settings', { values: { 'display.guide': JSON.stringify({ tour: 'done', list: 'hidden' }) } });
  // a marina at a shore the placing tool fits it to (tests/docks-http.test.mjs spotsFor)
  const world = async () => (await owner.get('/api/world')).json.world;
  let w = await world();
  const T = w.terrain, island = new Island(T, { roads: w.roads }).withPads(buildingPads(w)), net = RoadNetwork.fromJSON(w.roads);
  const env = { heightAt: (x, z) => island.height(x, z), isWater: (x, z) => !!island.waterAt(x, z), waterAt: (x, z) => island.waterAt(x, z), coastWhy: (x, z) => protectedWhy(island, x, z, 0), roads: net };
  let spot = null;
  for (const c of coastline(island)) {
    const dx = c.x - T.center.x, dz = c.z - T.center.z, d = Math.hypot(dx, dz);
    for (const back of [20, 40]) { const fit = fitToShore('marina', c.x - dx / d * back, c.z - dz / d * back, env); if (fit && !checkWorldModule(w, { kind: 'marina', ...fit }, env)) { spot = { kind: 'marina', ...fit }; break; } }
    if (spot) break;
  }
  check(!!spot, 'a shore for a marina');
  const placed = await owner.post('/api/edit', { ops: [{ op: 'wmod.add', module: spot }] });
  check(placed.status === 200, `the marina placed (${placed.status})`);
  w = await world();
  const m = w.worldModules.find(x => x.kind === 'marina'), slip = boatSlips(w).find(x => x.module === m.id && x.kind === 'coastal');
  const pier = DOCKS.marina.decks.find(d => d.kind === 'pier'), quay = toWorldAt(m, 4, (pier.f0 + pier.f1) / 2);
  const ag = (await owner.get('/api/agents')).json.agents;
  check(ag.length >= 1, `an agent (${ag[0]?.name})`);
  browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage(), errs = [];
  page.setDefaultTimeout(60000);
  page.on('pageerror', e => errs.push(String(e).slice(0, 300)));
  page.on('console', m2 => { if (m2.type() === 'error' && /boat|crew|fish/i.test(m2.text())) errs.push(m2.text().slice(0, 300)); });
  await page.goto(`${s.url}/?q=low`, { waitUntil: 'load' });
  await page.evaluate(async ([l, p]) => fetch('/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) }), ['owner', owner.password]);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__mvw?.ready && window.__mvw.net?.plans && window.__mvw.boatCrew && window.__mvw.boating && window.__mvw.fishing, null, { timeout: 240000, polling: 1000 });
  await sleep(2000);
  const shot = n => page.screenshot({ path: path.join(OUT, `${n}.png`) });
  await page.evaluate(() => {
    window.__crew = { catches: [], notes: [], shown: [] }; const A = window.__mvw;
    A.bus.on('msg:crew_catch', m => window.__crew.catches.push(m)); A.bus.on('msg:crew_note', m => window.__crew.notes.push(m));
    // (what toasts came on screen, as they came: a toast is gone again before a slow screenshot is done)
    new MutationObserver(list => { for (const r of list) for (const n of r.addedNodes) { const t = n.textContent || ''; if (/landed|pulled up/.test(t)) window.__crew.shown.push(t); } }).observe(document.body, { childList: true, subtree: true });
  });
  await page.evaluate(() => window.__mvw.setMode?.('play'));
  await sleep(2500);
  // the owner at the marina's quay, the agent following
  await page.evaluate(([x, z]) => window.__mvw.player.warp(x, z, -1), [quay.x, quay.z]);
  const api = body => page.evaluate(async b => { const n = await import('/js/core/net.js'); try { return await n.post('/api/companions', b); } catch (e) { return { error: e.message }; } }, body);
  const f = await api({ agent: ag[0].id, action: 'follow', target: 'me' });
  check(f.ok === true, `${ag[0].name} follows the owner (${f.text || f.error})`);
  await owner.post('/api/clock', { rate: 8 });
  const me = () => page.evaluate(() => { const p = window.__mvw.player; return { x: p.x, z: p.z }; });
  const close = await waitFor(async () => { const l = (await owner.get('/api/companions')).json.companions, p = await me(); const c = l[0]; return c?.pos && Math.hypot(c.pos.x - p.x, c.pos.z - p.z) < 12 ? c : null; }, 240000, 1500);
  check(!!close, `the agent came to the owner at the quay (${close ? 'yes' : 'no'})`);
  await owner.post('/api/clock', { rate: 1 });
  await shot('1-quay');
  // the owner takes the boat from its slip
  await page.evaluate(([x, z]) => window.__mvw.player.warp(x, z, -1), [slip.deck.x, slip.deck.z]);
  await sleep(1200);
  await page.evaluate(id => window.__mvw.net.send({ t: 'bboard', id }), slip.id);
  const out = await waitFor(() => page.evaluate(() => window.__mvw.boating.active), 20000);
  check(!!out, 'the owner is at the helm');
  // the agent walks down the pier and gets on: drawn at its spot on the deck
  const aboard = await waitFor(() => page.evaluate(() => (window.__mvw.boatCrew.stats.drawn >= 1 ? [...window.__mvw.boatCrew.rows.values()][0] : null)), 120000, 1000);
  check(!!aboard, `the agent is drawn aboard at its spot (${aboard ? `spot ${aboard.spot}, ${aboard.phase}` : 'no'})`);
  // the camera beside the boat, looking at the bow
  const look = () => page.evaluate(() => { const A = window.__mvw, c = A.cam, B = A.boating.state(); if (!B) return; c.goalDist = 9; c.goalPitch = 0.32; c.yaw = c.goalYaw = B.heading + Math.PI * 0.75; });
  await look(); await sleep(2000);
  await shot('2-aboard');
  // a trip: the agent fishes too
  await page.evaluate(() => window.__mvw.fishing.start('harbour-morning'));
  const fishing = await waitFor(() => page.evaluate(() => { const r = [...window.__mvw.boatCrew.rows.values()][0]; return r && r.phase !== 'aboard' ? r.phase : null; }), 60000, 500);
  check(!!fishing, `the agent fishes on the trip (${fishing})`);
  await look(); await sleep(1500); await shot('3-fishing');
  // up close: the camera on the agent at its spot, from beside the boat (after the boat's own camera each frame)
  await page.evaluate(() => {
    const A = window.__mvw; window.__lookAt = 0.35;
    A.bus.on('preframe', () => {
      if (window.__lookAt == null) return;
      const i = [...A.boatCrew.rows.keys()][0], s = A.boating.state(); if (i === undefined || !s) return;
      const x = A.agents.rx[i], y = A.agents.ry[i], z = A.agents.rz[i];
      A.cam.follow = () => ({ x, y: y + 1.1, z }); A.cam.goalDist = A.cam.dist = 4.4; A.cam.goalPitch = 0.2; A.cam.yaw = A.cam.goalYaw = s.heading + Math.PI * window.__lookAt;
    });
  });
  for (const [k, v] of [['a', 0.35], ['b', -0.35]]) { await page.evaluate(x => { window.__lookAt = x; }, v); await sleep(2500); await shot(`3-fishing-close-${k}`); }
  const phases = new Set();
  const caught = await waitFor(async () => { const r = await page.evaluate(() => [[...window.__mvw.boatCrew.rows.values()][0]?.phase, window.__crew.catches[0] || null]); if (r[0]) phases.add(r[0]); return r[1]; }, 360000, 700);
  check(!!caught, `a catch on the owner's page: ${caught?.text || 'none in six minutes'}`);
  check(phases.size >= 2, `its body went through the fishing (${[...phases].join(', ')})`);
  if (caught) { await sleep(400); await shot('4-catch'); await page.evaluate(() => { window.__lookAt = null; }); const toast = await page.evaluate(t => window.__crew.shown.some(x => x.includes(t)), caught.text); check(toast, 'the catch toast came on screen'); }
  // back off at the dock: the agent gets off with the owner
  await page.evaluate(() => window.__mvw.net.send({ t: 'bexit' }));
  const off = await waitFor(() => page.evaluate(() => !window.__mvw.boating.active && window.__mvw.boatCrew.rows.size === 0), 30000);
  check(!!off, 'off the boat, the agent with them (no longer drawn aboard)');
  await sleep(3000); await shot('5-off');
  const done = (await owner.get(`/api/play/profile?id=${-ag[0].id}`)).json;
  check((done?.modules?.fishing?.runs || 0) >= 1, `its trip is weighed in as its own (${done?.modules?.fishing?.runs || 0} trips, ${Math.round(done?.modules?.fishing?.xp || 0)} XP)`);
  check(!errs.length, `no page errors${errs.length ? `: ${errs.join(' | ')}` : ''}`);
} catch (e) { console.error(e); fails.push(String(e.message || e)); }
finally { await browser?.close?.(); await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(`${dir}.key`, { force: true }); }
console.log(fails.length ? `✗ ${fails.length} failed` : '✓ all passed');
process.exit(fails.length ? 1 : 0);
