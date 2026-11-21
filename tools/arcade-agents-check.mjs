#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see
// LICENSE). AI agents playing the arcade, seen in a real browser (docs/features/arcade.md §Agents at the arcade;
// server/play/arcade-crew.js). On a throwaway server with an arcade (the Floor Themes' own): the owner plays and walks into
// the arcade, an agent comes along; it is told to play the machine beside its owner (POST /api/interactions, as Free Will
// or its chat would) — the page must draw it at the machine, its Companions bar say "Playing <game> · <score>", and when
// the game is over its bubble ("🕹️ … on <game>!") and its owner's toast ("<name> scored … on <game>") come on screen.
// Screenshots: checks/arcade-agents/ (not kept in the repository). Usage: node tools/arcade-agents-check.mjs — exit 1 on
// a failure.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { WorldIndex } from '../server/sim/windex.js';
import { PlayerNav } from '../shared/playernav.js';
import { toWorld } from '../shared/geom.js';
import { ctxOf } from '../shared/constants.js';
import { machineGame } from '../shared/arcade/catalog.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), OUT = path.join(ROOT, 'checks', 'arcade-agents');
const { startServer, ownerSession } = await import(path.join(ROOT, 'tools/lib/testserver.mjs'));
const { launch, gpuInfo } = createRequire(import.meta.url)(path.join(ROOT, 'tools/lib/browser.cjs'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [], check = (ok, what) => { console.log(`${ok ? '  ✓' : '  ✗'} ${what}`); if (!ok) fails.push(what); };
const waitFor = async (fn, ms = 60000, every = 500) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } };

const s = await startServer({ population: 200, agents: 2 });
let browser;
try {
  const owner = await ownerSession(s);
  await owner.post('/api/account/settings', { values: { 'display.guide': JSON.stringify({ tour: 'done', list: 'hidden' }) } });
  // an arcade on the second floor of the biggest office
  const W0 = (await owner.get('/api/world')).json.world;
  const Bx = W0.buildings.filter(b => b && !b.gone && (b.type === 'office' || b.type === 'hq') && b.floors >= 3).sort((a, b) => b.w * b.d - a.w * a.d)[0];
  check((await owner.post('/api/edit', { ops: [{ op: 'lvl.theme', b: Bx.idx, f: 1, theme: 'arcade' }] })).status === 200, 'an arcade laid out');
  const world = (await owner.get('/api/world')).json.world, nav = new PlayerNav(world), idx = new WorldIndex(world), B = world.buildings[Bx.idx], ctx = ctxOf(Bx.idx, 1);
  // a machine with a short game (a check on a real clock), where one stands to play it
  const order = ['boxer', 'claw_machine', 'skeeball', 'hoop_shot', 'whack_mole', 'mech_bull'];
  let pick = null;
  for (const it of world.levels[B.lv[1]].items.filter(x => machineGame(x.t)).sort((x, y) => (order.indexOf(x.t) + 1 || 99) - (order.indexOf(y.t) + 1 || 99))) {
    const sl = idx.entry(Bx.idx, 1, it.id)?.slots[0];
    if (!sl) continue;
    const ap = toWorld(B, sl.ax, sl.az), at = toWorld(B, sl.lx, sl.lz);
    if (nav.ok(ap.x + 1.3, ap.z, ctx)) { pick = { it, ap, at, game: machineGame(it.t) }; break; }
  }
  check(!!pick, `a machine with a game (${pick?.game.title} on the ${pick?.it.t})`);
  if (!pick) throw new Error('no machine');
  const ag = (await owner.get('/api/agents')).json.agents, A = ag[0];
  browser = await launch();
  const bctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await bctx.newPage(), errs = [];
  page.setDefaultTimeout(60000);
  page.on('pageerror', e => errs.push(String(e).slice(0, 300)));
  console.log('GPU', await gpuInfo(page));
  await page.goto(`${s.url}/?q=low`, { waitUntil: 'load' });
  await page.evaluate(async p => fetch('/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'owner', password: p }) }), owner.password);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__mvw?.ready && window.__mvw.net?.plans && window.__mvw.player && window.__mvw.arcade, null, { timeout: 300000, polling: 1000 });
  check(!!await page.waitForFunction(() => window.__mvw.agents?.chars?.loaded, null, { timeout: 600000, polling: 2000 }).then(() => true, () => false), 'the characters are loaded');
  await page.evaluate(() => {
    window.__arc = { scores: [], shown: [], says: [] }; const A = window.__mvw;
    A.bus.on('msg:crew_arcade', m => window.__arc.scores.push(m));
    A.bus.on('say', m => window.__arc.says.push(m.text));
    // (what toasts came on screen, as they came: a toast is gone again before a slow screenshot is done)
    new MutationObserver(list => { for (const r of list) for (const n of r.addedNodes) { const t = n.textContent || ''; if (/ scored /.test(t)) window.__arc.shown.push(t); } }).observe(document.body, { childList: true, subtree: true });
  });
  await page.evaluate(() => window.__mvw.setMode?.('play'));
  check(!!await waitFor(() => page.evaluate(() => !!window.__mvw.player?.active), 60000), 'playing');
  // into the arcade, beside the machine; its agent comes along (the clock fast while it walks over)
  const yaw = Math.atan2(pick.at.x - pick.ap.x, pick.at.z - pick.ap.z);
  await page.evaluate(([x, z, c, y]) => window.__mvw.player.warp(x, z, c, y), [pick.ap.x + 1.3, pick.ap.z, ctx, yaw]);
  check((await owner.post('/api/companions', { agent: A.id, action: 'follow', target: 'me' })).json.ok === true, `${A.name} follows the owner`);
  await owner.post('/api/clock', { rate: 10 });
  const near = await waitFor(async () => { const x = (await owner.get(`/api/agent/${A.i}`)).json; return x.pos?.ctx === ctx && Math.hypot(x.pos.x - pick.ap.x, x.pos.z - pick.ap.z) < 5 ? x : null; }, 240000, 1000);
  check(!!near, `${A.name} came into the arcade`);
  await owner.post('/api/clock', { rate: 1 });
  // what it can do there: the machine's game; told to (as Free Will or its chat would choose it)
  const things = (await owner.get(`/api/interactions?agent=${A.id}`)).json.things || [];
  const id = `arcade:${Bx.idx}.1.${pick.it.id}`, thing = things.find(x => x.id === id);
  check(!!thing, `offered: "${thing?.label}"`);
  const r = (await owner.post('/api/interactions', { agent: A.id, id })).json || {};
  check(r.ok === true, `told to play: "${r.text}"`);
  // at the machine, playing: the Companions bar on the page
  const bar = await waitFor(() => page.evaluate(i => document.querySelector(`.party-face[data-cm="${i}"] .pf-t small`)?.textContent || null, A.id).then(t => (t && t.startsWith(`Playing ${pick.game.title}`) ? t : null)), 120000, 700);
  check(!!bar, `the Companions bar: "${bar}"`);
  const drawn = await waitFor(() => page.evaluate(([x, z, i]) => { const ag = window.__mvw.agents, d = Math.hypot(ag.rx[i] - x, ag.rz[i] - z); return d < 0.8 ? d : null; }, [pick.at.x, pick.at.z, A.i]), 30000, 500);
  check(drawn != null, `drawn at the machine (${drawn?.toFixed(2)} m from its spot)`);
  // (at once: a short game is over in seconds) — the owner's own camera, then from above the machine
  await page.screenshot({ path: path.join(OUT, '1-playing.png') });
  await page.evaluate(([at, ap]) => {
    const M = window.__mvw, T = M.THREE, fx = ap.x - at.x, fz = ap.z - at.z, l = Math.hypot(fx, fz) || 1, y = M.player.y;
    M.cam.pinTo(new T.Vector3(at.x + fx / l * 2.2, y + 3.2, at.z + fz / l * 2.2), new T.Vector3(at.x, y + 0.8, at.z));
  }, [pick.at, pick.ap]);
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, '1b-playing-above.png') });
  // the game over: its bubble, its owner's toast
  const done = await waitFor(() => page.evaluate(() => window.__arc.scores[0] || null), 420000, 1000);
  check(!!done, `the game over: ${done ? `${done.text} (${done.score})` : 'not yet'}`);
  if (done) {
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, '2-scored.png') });
    check(await page.evaluate(t => window.__arc.shown.some(x => x.includes(t)), done.text), 'its owner\'s toast came on screen');
    check(await page.evaluate(g => window.__arc.says.some(x => x.startsWith('🕹️') && x.includes(g)), pick.game.title), 'its bubble over its head');
    const profile = (await owner.get(`/api/play/profile?id=${-A.id}`)).json;
    check(profile?.modules?.arcade?.best?.[pick.game.id]?.score === done.score, `recorded as its own (${A.name}'s best on ${pick.game.title}: ${profile?.modules?.arcade?.best?.[pick.game.id]?.score})`);
    const back = await waitFor(() => page.evaluate(i => document.querySelector(`.party-face[data-cm="${i}"] .pf-t small`)?.textContent || null, A.id).then(t => (t && !t.startsWith('Playing') ? t : null)), 30000, 700);
    check(!!back, `back at its owner's side: "${back}"`);
  }
  await page.evaluate(() => window.__mvw.cam.unpin());
  check(errs.length === 0, `no page errors${errs.length ? `: ${errs.join(' | ')}` : ''}`);
} catch (e) { fails.push(e.message); console.error(e); } finally {
  try { await browser?.close(); } catch { /* closed */ }
  await s.stop();
}
console.log(fails.length ? `FAILED: ${fails.length}` : 'all passed', `— screenshots in ${path.relative(ROOT, OUT)}/`);
process.exit(fails.length ? 1 : 0);
