#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An AI agent as its owner's opponent, seen in a real browser (2026-11-17, the product owner: "Today the player plays the
// CPU … I want to play with my AI agents"; server/play/versus.js, client/js/play/machine-play.js). On a throwaway server:
// an office floor made an arcade, the owner walks up to its air hockey table with an agent following, and plays it (E,
// as anyone does). The agent (no Free Will here: it joins in by itself) walks to the other end — the game waits, saying
// so —, is drawn there playing (the table's clip, the striker in its hand), and the game has it as the other player by
// name; the owner plays a whole game (a hand on the mouse, following the puck), the results card shows the agent's side
// ("Good game! …"), its bubble says it, its own play profile has the game; leaving, it is back at the owner's side.
// Screenshots: checks/versus/ (not kept in the repository: /checks/ in .gitignore). Every step waits for its state, no
// timings (a software-drawn browser is slow). Usage: node tools/versus-check.mjs   Exit 1 on a failure.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { WorldIndex } from '../server/sim/windex.js';
import { toWorld } from '../shared/geom.js';
import { versusOf, farSlot } from '../shared/versus.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), OUT = path.join(ROOT, 'checks', 'versus');
const { startServer, ownerSession } = await import(path.join(ROOT, 'tools/lib/testserver.mjs'));
const { launch, gpuInfo } = createRequire(import.meta.url)(path.join(ROOT, 'tools/lib/browser.cjs'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [], check = (ok, what) => { console.log(`${ok ? '  ✓' : '  ✗'} ${what}`); if (!ok) fails.push(what); };
const waitFor = async (fn, ms = 60000, every = 500) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } };
const GAME = process.env.VERSUS_GAME || 'air_hockey';

const s = await startServer({ population: 200, agents: 2 });
let browser;
try {
  const owner = await ownerSession(s);
  await owner.post('/api/account/settings', { values: { 'display.guide': JSON.stringify({ tour: 'done', list: 'hidden' }) } });
  // an arcade (an office floor themed as one: its tables for two among its machines)
  const W0 = (await owner.get('/api/world')).json.world;
  const B0 = W0.buildings.filter(b => b && !b.gone && (b.type === 'office' || b.type === 'hq') && b.floors >= 3).sort((a, b) => b.w * b.d - a.w * a.d)[0];
  check((await owner.post('/api/edit', { ops: [{ op: 'lvl.theme', b: B0.idx, f: 1, theme: 'arcade' }] })).status === 200, 'an arcade on an office floor');
  const world = (await owner.get('/api/world')).json.world, idx = new WorldIndex(world), B = world.buildings[B0.idx];
  let table = null;
  for (const [id, e] of idx.slots(B.lv[1])) {
    const v = versusOf(e.it.t);
    if (table || !v?.game || e.it.t !== GAME) continue;
    const far = farSlot(v), you = farSlot(v, null, [far]), sl = e.slots[you];
    const at = toWorld(B, sl.lx, sl.lz), ap = toWorld(B, sl.ax, sl.az);
    table = { id, t: e.it.t, v, far: toWorld(B, e.slots[far].lx, e.slots[far].lz), at, ap, yaw: Math.atan2(at.x - ap.x, at.z - ap.z) };
  }
  check(!!table, `its ${GAME} table`);
  if (!table) throw new Error('no table');
  const ctx = B.idx * 64 + 1;
  const ag = (await owner.get('/api/agents')).json.agents, A = ag[0];
  browser = await launch();
  const bctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await bctx.newPage(), errs = [];
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
  // to the table's near end (an admin's warp), facing it; the agent comes along (the clock fast while it walks over)
  // (the floor shown and its furniture in reach, as walking in does: the page's focus — tools/kitchen-play-check.mjs)
  await page.evaluate(([x, z, c, yaw, b, f]) => { window.__mvw.player.warp(x, z, c, yaw); return import('/js/core/state.js').then(({ setFocus }) => { setFocus(b, f); window.__mvw.applyFocus(); }); }, [table.ap.x, table.ap.z, ctx, table.yaw, B.idx, 1]);
  check((await owner.post('/api/companions', { agent: A.id, action: 'follow', target: 'me' })).json.ok === true, `${A.name} follows the owner`);
  await owner.post('/api/clock', { rate: 10 });
  const near = await waitFor(async () => { const x = (await owner.get(`/api/agent/${A.i}`)).json; return x.pos?.ctx === ctx && Math.hypot(x.pos.x - table.ap.x, x.pos.z - table.ap.z) < 4.5 ? x : null; }, 300000, 1000);
  check(!!near, `${A.name} came to the arcade with the owner`);
  await owner.post('/api/clock', { rate: 1 });
  // the owner plays: E at the table (its game opens at the machine itself)
  await waitFor(() => page.evaluate(id => window.__mvw.player.target?.k === 'slot' && window.__mvw.player.target.e?.id === id, table.id), 20000);
  await page.keyboard.press('e');
  check(!!await waitFor(() => page.evaluate(() => !!window.__mvw.machinePlay?.active), 20000), 'the game opens at the table');
  // (the game waits while it walks to the far end — or it is there already, beside the table: no wait to see)
  const waiting = await waitFor(() => page.evaluate(() => document.querySelector('.mp-vs-wait p')?.textContent || null), 8000, 200);
  console.log(`    the game ${waiting ? `waited for it: "${waiting}"` : 'had it at once (it was at the table already)'}`);
  if (waiting) await page.screenshot({ path: path.join(OUT, '1-waiting.png') });
  const foe = await waitFor(() => page.evaluate(() => { const f = document.querySelector('.mp-foe'); return f && !f.classList.contains('hidden') ? f.textContent : null; }), 120000, 500);
  check(!!foe && foe.includes(A.name), `the other player is ${A.name}: "${foe}"`);
  // drawn at the other end, playing (the table's own clip)
  const drawn = await waitFor(() => page.evaluate(([fx, fz, i]) => import('/js/render/anim.js').then(({ CLIP_NAMES }) => {
    const ag = window.__mvw.agents, d = Math.hypot(ag.rx[i] - fx, ag.rz[i] - fz), clip = CLIP_NAMES[ag.clip[i]] || '';
    return d < 0.6 && /hockey|pool|foos|pingpong/.test(clip) ? { d, clip } : null;
  }), [table.far.x, table.far.z, A.i]), 60000, 700);
  check(!!drawn, `${A.name} drawn at the other end, playing (${drawn ? `${drawn.clip}, ${drawn.d.toFixed(2)} m from its place` : 'no'})`);
  const own = await waitFor(() => page.evaluate(i => { const C = window.__mvw.agents.chars; return !!C.kinds[C.kindOf[i]]; }, A.i), 300000, 2000);
  check(!!own, `${A.name} drawn with its own character`);
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, '2-playing-against-it.png') });
  // a whole game: a hand on the mouse, following the puck in its own half (the game's own pointer: client/js/play/machines/puck-rush.js)
  const t0 = Date.now(), LIMIT_MS = Number(process.env.VERSUS_LIMIT_MS) || 300000;
  let last = 0, goals = 0;
  for (;;) {
    const st = await page.evaluate(() => {
      const P = window.__mvw.machinePlay?.session;
      if (!P?.s) return null;
      const s = P.s, C = window.__mvw.stage.camera, r = window.__mvw.stage.renderer.domElement.getBoundingClientRect();
      const tz = s.pz > 0.05 ? s.pz + 0.05 : 0.75, tx = s.pz > 0.05 ? s.px : s.px * 0.4;   // (behind the puck in your half, else home)
      const v = P.world([tx, 0.8, tz]).project(C);
      return { state: P.state, x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, me: s.me, cpu: s.cpu };
    });
    if (!st || st.state === 'results' || Date.now() - t0 > LIMIT_MS) break;
    if (st.state === 'playing') await page.mouse.move(st.x, st.y, { steps: 2 });
    goals = Math.max(goals, (st.me || 0) + (st.cpu || 0));
    if (Date.now() - last > 30000) { last = Date.now(); console.log(`    … ${st.state} ${st.me}–${st.cpu}`); }
    await sleep(40);
  }
  // the game over (seven goals or its two-minute clock — in the game's own time: a software-drawn browser plays it several
  // times slower than real time, so it may not end within LIMIT_MS: then the score so far is the check, and the result for
  // both is tests/unit/versus.test.mjs's, played to the end on the server)
  const over = await page.evaluate(() => window.__mvw.machinePlay?.session?.state === 'results');
  check(goals > 0, `played for real: goals scored (${goals})`);
  if (over) {
    const res = await waitFor(() => page.evaluate(() => { const v = document.querySelector('.mp-res .mp-vs'); return v ? v.textContent : null; }), 60000, 500);
    check(!!res && res.includes(A.name) && /Good game!/.test(res), `the results card has ${A.name}'s side: "${res}"`);
    await sleep(800);
    await page.screenshot({ path: path.join(OUT, '3-results.png') });
    const said = await waitFor(() => page.evaluate(i => window.__mvw.S.says.get(i)?.text || null, A.i).then(t => (/^Good game!/.test(t || '') ? t : null)), 20000, 300);
    check(!!said, `its bubble: "${said}"`);
    const prof = (await owner.get(`/api/play/profile?id=${-A.id}`)).json;
    check(prof?.modules?.arcade?.runs >= 1, `its own play profile has the game (arcade: ${prof?.modules?.arcade?.runs} runs, level ${prof?.modules?.arcade?.level})`);
    const mine = (await owner.get('/api/play/profile')).json;
    check(mine?.modules?.arcade?.runs >= 1, 'the owner\'s too');
  } else console.log(`    the game not over within ${LIMIT_MS / 60000} min here (slow rendering): the result for both is tests/unit/versus.test.mjs's`);
  // leaving the game: it is back at the owner's side
  await page.click('.mp-leave');
  const back = await waitFor(async () => !(await owner.get('/api/versus')).json.vs, 60000, 1000);
  check(!!back, `${A.name} left the table with the owner`);
  check(errs.length === 0, `no page errors${errs.length ? `: ${errs.join(' | ')}` : ''}`);
} catch (e) { fails.push(e.message); console.error(e); } finally {
  try { await browser?.close(); } catch { /* closed */ }
  await s.stop();
}
console.log(fails.length ? `FAILED: ${fails.length}` : 'all passed', `— screenshots in ${path.relative(ROOT, OUT)}/`);
process.exit(fails.length ? 1 : 0);
