#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A companion cooking Order Up alongside its owner, seen in a real browser (server/play/kitchen-play.js). On a throwaway
// server: the owner plays, walks into a café with their agent following, and starts a Rush in its kitchen from their own
// page (🍳 Order Up, a Warm-up) — the agent (no Free Will of its own) goes into the kitchen and cooks a Rush of its own
// alongside: the page draws it at the kitchen's stations with the cooking clip while the owner cooks, their page tells
// them (a toast), and when the Rush's minutes are over its result comes as a toast and its Rush is on its own record.
// Screenshots: checks/kitchen-play/ (not kept in the repository). The headless browser here is slow (software
// rendering): every step waits for its state, no tight timings.
// Usage: node tools/kitchen-play-check.mjs   (exit 1 on a failure)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), OUT = path.join(ROOT, 'checks', 'kitchen-play');
const { startServer, ownerSession } = await import(path.join(ROOT, 'tools/lib/testserver.mjs'));
const { launch } = createRequire(import.meta.url)(path.join(ROOT, 'tools/lib/browser.cjs'));
const { PlayerNav } = await import(path.join(ROOT, 'shared/playernav.js'));
const { WorldIndex } = await import(path.join(ROOT, 'server/sim/windex.js'));
const { toWorld } = await import(path.join(ROOT, 'shared/geom.js'));
const { ctxOf } = await import(path.join(ROOT, 'shared/constants.js'));
const { kitchenOf } = await import(path.join(ROOT, 'shared/orderup/kitchens.js'));
const { KitchenPlay } = await import(path.join(ROOT, 'server/play/kitchen-play.js'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [], check = (ok, what) => { console.log(`${ok ? '  ✓' : '  ✗'} ${what}`); if (!ok) fails.push(what); };
const waitFor = async (fn, ms = 60000, every = 500) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } };

const s = await startServer({ population: 160, agents: 1 });
let browser;
try {
  const owner = await ownerSession(s);
  await owner.post('/api/account/settings', { values: { 'display.guide': JSON.stringify({ tour: 'done', list: 'hidden' }) } });
  const world = (await owner.get('/api/world')).json.world, nav = new PlayerNav(world), idx = new WorldIndex(world);
  // a ground-floor café with its kitchen: a spot in its room, and where its cooks stand
  let K = null;
  for (const v of idx.venues.cafe) {
    const B = world.buildings[v.b], L = world.levels[B.lv[v.f]], rec = (L.mods || []).find(m => m.kind === 'kitchen');
    if (K || v.f !== 0 || !rec) continue;
    const ctx = ctxOf(v.b, v.f), KT = kitchenOf(rec.data?.kitchen);
    const spots = L.items.filter(it => it.mod === rec.id && KT.stations[it.t]).map(it => ({ t: it.t, ...KitchenPlay.spotOf(it) })).map(p => ({ t: p.t, ...toWorld(B, p.lx, p.lz) }));
    for (const [, e] of idx.slots(B.lv[v.f])) for (const sl of e.slots) {
      const p = toWorld(B, sl.ax, sl.az);
      if (!K && (sl.use === 'eat' || sl.use === 'relax') && nav.ok(p.x, p.z, ctx)) K = { b: v.b, f: v.f, ctx, spot: p, spots, name: L.name || B.name };
    }
  }
  check(!!K, `a café with a kitchen (${K?.name})`);
  if (!K) throw new Error('no café');
  const A = (await owner.get('/api/agents')).json.agents[0];
  browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage(), errs = [];
  page.setDefaultTimeout(60000);
  page.on('pageerror', e => errs.push(String(e).slice(0, 300)));
  await page.goto(`${s.url}/?q=low`, { waitUntil: 'load' });
  await page.evaluate(async p => fetch('/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'owner', password: p }) }), owner.password);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__mvw?.ready && window.__mvw.net?.plans && window.__mvw.player && window.__mvw.orderUp, null, { timeout: 300000, polling: 1000 });
  check(!!await page.waitForFunction(() => window.__mvw.agents?.chars?.loaded, null, { timeout: 600000, polling: 2000 }).then(() => true, () => false), 'the characters are loaded');
  await page.evaluate(() => {
    window.__kp = { notes: [], shown: [] }; const W = window.__mvw;
    W.bus.on('msg:crew_note', m => window.__kp.notes.push(m.text));
    new MutationObserver(list => { for (const r of list) for (const n of r.addedNodes) { const t = n.textContent || ''; if (/cooking|Warm-up/.test(t)) window.__kp.shown.push(t); } }).observe(document.body, { childList: true, subtree: true });
  });
  await page.evaluate(() => window.__mvw.setMode?.('play'));
  check(!!await waitFor(() => page.evaluate(() => !!window.__mvw.player?.active), 60000), 'playing');
  // into the café (an admin's warp); its agent comes along (the clock fast while it walks over)
  // (a warp doesn't look into the floor as walking in through the door does — player.js: the page's focus, set here)
  await page.evaluate(([x, z, c, b, f]) => { window.__mvw.player.warp(x, z, c); return import('/js/core/state.js').then(({ setFocus }) => { setFocus(b, f); window.__mvw.applyFocus(); }); }, [K.spot.x, K.spot.z, K.ctx, K.b, K.f]);
  check((await owner.post('/api/companions', { agent: A.id, action: 'follow', target: 'me' })).json.ok === true, `${A.name} follows the owner`);
  await owner.post('/api/clock', { rate: 10 });
  const came = await waitFor(async () => { const x = (await owner.get(`/api/agent/${A.i}`)).json; return x.pos?.ctx === K.ctx ? x : null; }, 300000, 1000);
  check(!!came, `${A.name} came into the café`);
  await owner.post('/api/clock', { rate: 1 });
  // the owner's own Order Up: the kitchen view, a Warm-up — as a player starts one
  const opened = await waitFor(() => page.evaluate(() => { const o = window.__mvw.orderUp; if (!o.game) o.start(); return !!o.game; }), 30000, 1000);
  if (!opened) console.log('  (the page:', JSON.stringify(await page.evaluate(() => import('/js/core/state.js').then(({ S }) => { const e = window.__mvw.inter?.foc?.entries || [], P = window.__mvw.player; return { focus: S.focus, player: { ctx: P.ctx, x: Math.round(P.x), z: Math.round(P.z) }, entries: e.length, ou: e.filter(x => String(x.t).startsWith('ou_')).map(x => x.t).slice(0, 12) }; }))), ')');
  check(!!opened, 'the owner opens Order Up in the café\'s kitchen');
  await sleep(1500);
  await page.evaluate(() => document.querySelector('.ou-course[data-c="warmup"]')?.click());
  await sleep(300);
  await page.evaluate(() => document.querySelector('.ou-go')?.click());
  const begun = await waitFor(() => page.evaluate(() => !!window.__mvw.orderUp.game?.run), 30000);
  check(!!begun, 'the owner\'s Rush begins (a Warm-up)');
  await page.screenshot({ path: path.join(OUT, '1-rush.png') });
  // its agent joins: into the kitchen, cooking alongside
  const along = await waitFor(async () => { const l = (await owner.get('/api/companions')).json.companions || []; const c = l.find(x => x.agent === A.id); return c?.busy?.kind === 'orderup' && /^Cooking a Warm-up alongside/.test(c.doing || '') ? c : null; }, 90000, 1000);
  check(!!along, `${A.name} cooks alongside: "${along?.doing || 'no'}"`);
  // the page draws it at the kitchen's stations, cooking (the clip), moving between them
  const seen = new Set(), clips = new Set();
  const drawn = await waitFor(() => page.evaluate(([spots, i]) => import('/js/render/anim.js').then(({ CLIP_NAMES }) => {
    const ag = window.__mvw.agents, x = ag.rx[i], z = ag.rz[i], at = spots.find(p => Math.hypot(p.x - x, p.z - z) < 0.6);
    return { at: at?.t || null, clip: CLIP_NAMES[ag.clip[i]] || '' };
  }), [K.spots, A.i]).then(r => { if (r.at) seen.add(r.at); clips.add(r.clip); return seen.size >= 3 ? r : null; }), 100000, 700);
  check(!!drawn, `drawn at the kitchen's stations (${[...seen].join(', ')}), clips ${[...clips].join(', ')}`);
  check(clips.has('cook'), 'with the cooking clip');
  await page.screenshot({ path: path.join(OUT, '2-cooking-alongside.png') });
  check(await page.evaluate(() => window.__kp.notes.some(t => /started cooking a Warm-up .*alongside you/.test(t))), 'its owner\'s page told (a toast)');
  // the Rush's minutes over: its result on the owner's page, on its own record
  const result = await waitFor(() => page.evaluate(() => window.__kp.notes.find(t => /finished a Warm-up .* pts/.test(t)) || null), 200000, 1000);
  check(!!result, `its result: ${result || `none (its notes: ${JSON.stringify(await page.evaluate(() => window.__kp.notes))})`}`);
  await page.screenshot({ path: path.join(OUT, '3-result.png') });
  const prof = (await owner.get(`/api/play/profile?id=${-A.id}`)).json;
  check((prof?.modules?.orderup?.runs || 0) >= 1, `on its own record (${prof?.modules?.orderup?.runs || 0} Rush, ${prof?.modules?.orderup?.xp || 0} XP)`);
  check(!errs.length, `no page errors${errs.length ? `: ${errs.join(' | ')}` : ''}`);
} catch (e) { console.error(e); fails.push(String(e.message || e)); }
finally { await browser?.close?.(); await s.stop(); }
console.log(fails.length ? `✗ ${fails.length} failed` : '✓ all passed');
process.exit(fails.length ? 1 : 0);
