#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// People in cars, seen in a real browser (2026-11-16, the product owner: "the driver should be visible, and other
// companions aswell. so they are visible on the seat ... agents using cars to go places ... should appear as drivers
// inside the car, so please make it look right"; render/car-occupants.js). On a throwaway server with an island:
//   player   — the owner plays, three of their agents follow; the owner gets into a car, the agents get in with them
//              (three passengers, then one); a second player watches. Screenshots at rest and driving, from behind the
//              car (the driver's own view) and from the second player's page (side, rear three-quarter, top), and the
//              people's places in their car's own frame frame by frame while it drives (they must not move in it).
//   resident — an agent drives its own car back from the island's Radio Station: at the wheel, the same checks.
// Screenshots: checks/car-occupants/ (not kept in the repository: /checks/ in .gitignore). Usage: node tools/car-occupants-check.mjs [player|resident]
// Exit 1 on a failure.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), OUT = path.join(ROOT, 'checks', 'car-occupants');
const { startServer, ownerSession, userSession, tempDir } = await import(path.join(ROOT, 'tools/lib/testserver.mjs'));
const { launch, gpuInfo } = createRequire(import.meta.url)(path.join(ROOT, 'tools/lib/browser.cjs'));
fs.mkdirSync(OUT, { recursive: true });
const which = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ['player', 'resident']);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [], check = (ok, what) => { console.log(`${ok ? '  ✓' : '  ✗'} ${what}`); if (!ok) fails.push(what); };
const waitFor = async (fn, ms = 30000, every = 300) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } };

// an island with its roads (tools/wp4), so residents drive and there are roads to drive on
const dir = tempDir('mvw-occupants-');
await (await startServer({ data: dir, population: 200, agents: 3 })).stop({ keepData: true });
for (const tool of ['add-island', 'add-roads']) { const r = spawnSync(process.execPath, [`tools/wp4/${tool}.mjs`, '--data', dir, '--server-stopped'], { cwd: ROOT, encoding: 'utf8' }); if (r.status) throw new Error(r.stderr); }
const s = await startServer({ data: dir, population: 200 });
let browser;
try {
  const owner = await ownerSession(s);
  for (const c of [owner]) await c.post('/api/account/settings', { values: { 'display.guide': JSON.stringify({ tour: 'done', list: 'hidden' }) } });
  browser = await launch();
  console.log('GPU', await (async () => { const p = await browser.newPage(); const g = await gpuInfo(p); await p.close(); return g; })());
  const open = async (login, password, viewport = { width: 1280, height: 800 }) => {
    const ctx = await browser.newContext({ viewport }), page = await ctx.newPage(), errs = [];
    page.setDefaultTimeout(30000);
    page.on('pageerror', e => errs.push(String(e).slice(0, 300)));
    page.on('console', m => { if (m.type() === 'error' && /car occupants|car-occupants|seat/i.test(m.text())) errs.push(m.text().slice(0, 300)); });
    await page.goto(`${s.url}/?q=high`, { waitUntil: 'load' });
    await page.evaluate(async ([l, p]) => fetch('/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) }), [login, password]);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__mvw?.ready && window.__mvw.net?.plans && window.__mvw.carOccupants && window.__mvw.driving?.ready, null, { timeout: 180000, polling: 500 });
    await sleep(2000);
    return { page, errs };
  };
  const shot = (page, n) => page.screenshot({ path: path.join(OUT, `${n}.png`) });
  const setRate = rate => owner.post('/api/clock', { rate });
  // the people in cars as a page has them: who, where (world), and where in their car's own frame (the asset's: +Z ahead)
  const occupants = page => page.evaluate(async () => {
    const A = window.__mvw, THREE = A.THREE, O = A.carOccupants, out = [];
    const m = new THREE.Matrix4(), inv = new THREE.Matrix4(), v = new THREE.Vector3();
    for (const [key, q] of O.placed) {
      let car = null;
      if (typeof q.car === 'number') { const r = A.driving.byId.get(q.car); if (r) { A.traffic.carMatrix(r.draw || r.latest, m); car = { id: q.car, k: (r.draw || r.latest).k, v: (r.draw || r.latest).v }; } }
      if (!car) { out.push({ key, ...q }); continue; }
      v.set(q.x, q.y, q.z).applyMatrix4(inv.copy(m).invert());
      out.push({ key, x: q.x, y: q.y, z: q.z, car, local: [v.x, v.y, v.z] });
    }
    return { list: out, stats: { ...O.stats } };
  });
  if (which.has('player')) await playerPhase();
  if (which.has('resident')) await residentPhase();

  async function playerPhase() {
    console.log('— a player driving, their companions riding, a second player watching');
    const ag = (await owner.get('/api/agents')).json.agents;
    check(ag.length >= 3, `three agents (${ag.length})`);
    const watcher = await userSession(s, owner, { login: 'watcher', displayName: 'Watcher' });
    await watcher.post('/api/account/settings', { values: { 'display.guide': JSON.stringify({ tour: 'done', list: 'hidden' }) } });
    const O1 = await open('owner', owner.password), page = O1.page;
    await page.evaluate(() => window.__mvw.setMode?.('play'));
    await sleep(2500);
    const api = body => page.evaluate(async b => { const n = await import('/js/core/net.js'); try { return await n.post('/api/companions', b); } catch (e) { return { error: e.message }; } }, body);
    for (const a of ag.slice(0, 3)) { const r = await api({ agent: a.id, action: 'follow', target: 'me' }); check(r.ok === true, `${a.name} follows the owner (${r.text || r.error})`); }
    await setRate(10);
    const me = () => page.evaluate(() => { const p = window.__mvw.player; return { x: p.x, y: p.y, z: p.z, ctx: p.ctx }; });
    const near = await waitFor(async () => { const l = (await owner.get('/api/companions')).json.companions, p = await me(); return l.length >= 3 && l.every(c => c.pos && c.pos.ctx === -1 && Math.hypot(c.pos.x - p.x, c.pos.z - p.z) < 8) ? l : null; }, 150000, 1000);
    check(!!near, 'all three came out to the owner');
    // a car close by, the traffic held still while the owner gets in (the clock stopped: so are the residents)
    await setRate(0); await sleep(600);
    const car = await page.evaluate(async () => {
      const A = window.__mvw, p = A.player, list = A.driving.list().filter(c => !c.driver && c.k <= 2).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      const c = list[0]; if (!c) return null;
      // beside its driver's door (the car's left: its +X in the asset, the physics' -Z turned by its yaw)
      const lx = -Math.sin(c.yaw), lz = -Math.cos(c.yaw), w = A.driving.rigs[c.k].halfWidth + 0.7;
      A.player.warp(c.x + lx * w, c.z + lz * w, -1);
      await new Promise(r => setTimeout(r, 900));
      try { await A.driving.enter(c); return { id: c.id, k: c.k, kind: A.driving.rigs[c.k].kind }; } catch (e) { return { error: e.message, id: c.id }; }
    });
    check(car && !car.error, `the owner got into a ${car?.kind} (${car?.error || 'ok'})`);
    if (!car || car.error) return;
    await setRate(2);
    const rode = await waitFor(async () => { const n = await page.evaluate(id => window.__mvw.net.vseats.get(id)?.length || 0, car.id); return n >= 3 ? n : null; }, 60000, 500);
    check(rode === 3, `the three companions got in (${rode ?? 0} seated, as the server told the page)`);
    await setRate(1);
    await sleep(1500);
    let o = await occupants(page);
    const inCar = o.list.filter(q => q.car?.id === car.id);
    check(inCar.length === 4 && inCar.some(q => q.key === 'me'), `four people drawn in the car, the owner at the wheel: ${inCar.map(q => q.key).join(', ')}`);
    // the second player: watching from their own page (explore mode, the camera round the car)
    const O2 = await open('watcher', watcher.password), page2 = O2.page;
    const view = (pg, { yaw, pitch, dist }) => pg.evaluate(([id, yaw, pitch, dist]) => {
      const A = window.__mvw, c = A.cam, at = () => { const r = A.driving.byId.get(id), d = r?.draw || r?.latest; return d ? { x: d.x, y: (d.y || 0) + 0.9, z: d.z, h: (d.yaw || 0) + Math.PI / 2 } : null; };
      const q = at(); if (!q) return false;
      c.follow = () => { const w = at(); return w ? { x: w.x, y: w.y, z: w.z } : null; };
      c.jumpTo(q.x, q.y, q.z, dist); c.yaw = c.goalYaw = q.h + yaw; c.pitch = c.goalPitch = pitch; c.apply();
      window.__viewYaw = yaw;
      return true;
    }, [car.id, yaw, pitch, dist]);
    // (the watcher's page keeps the camera turned with the car as it drives)
    await page2.evaluate(id => { const A = window.__mvw; A.bus.on('preframe', () => { if (window.__viewYaw == null) return; const r = A.driving.byId.get(id), d = r?.draw || r?.latest; if (!d) return; A.cam.yaw = A.cam.goalYaw = d.yaw + Math.PI / 2 + window.__viewYaw; }); }, car.id);
    await page2.evaluate(() => window.__mvw.setMode?.('explore'));
    const seen2 = await waitFor(async () => { const q = await occupants(page2); return q.list.filter(x => x.car?.id === car.id).length >= 4 ? q : null; }, 30000, 500);
    check(!!seen2, `the second player's page draws the driver and the three passengers too (${seen2?.list.filter(x => x.car?.id === car.id).map(x => x.key).join(', ') || 'no'})`);
    const views = { side: { yaw: Math.PI / 2, pitch: 0.12, dist: 5.2 }, other: { yaw: -Math.PI / 2, pitch: 0.12, dist: 5.2 }, rear34: { yaw: Math.PI * 0.78, pitch: 0.3, dist: 6.5 }, top: { yaw: Math.PI, pitch: 1.45, dist: 7 }, front: { yaw: 0.05, pitch: 0.18, dist: 6 } };
    for (const [n, v] of Object.entries(views)) { await view(page2, v); await sleep(900); await shot(page2, `p3-rest-${n}`); }
    await shot(page, 'p3-rest-driver-view');
    // the places in the car's own frame: the same each frame while it drives (the seat is the car's)
    const sample = async (pg, ms) => pg.evaluate(async ([id, ms]) => {
      const A = window.__mvw, THREE = A.THREE, O = A.carOccupants, out = new Map(), m = new THREE.Matrix4(), inv = new THREE.Matrix4(), v = new THREE.Vector3();
      let speed = 0, frames = 0;
      // the car's matrix as render/traffic.js drew it this frame (its body's first part instance), against where the
      // occupant pass put each person this frame
      const T = A.traffic, part = () => T.batches[A.driving.byId.get(id).latest.k][0].mesh;
      const off = A.bus.on('postframe', () => {
        const vc = T.visibleCars?.find(c => c.id === id); if (!vc) return;
        part().getMatrixAt(vc.idx, m); inv.copy(m).invert(); frames++;
        const r = A.driving.byId.get(id), d = r.draw || r.latest; speed = Math.max(speed, Math.abs(d.v || 0));
        for (const [key, q] of O.placed) if (q.car === id) { v.set(q.x, q.y, q.z).applyMatrix4(inv); let s = out.get(key); if (!s) out.set(key, s = { n: 0, min: [9, 9, 9], max: [-9, -9, -9] }); s.n++; for (let k = 0; k < 3; k++) { const c = [v.x, v.y, v.z][k]; s.min[k] = Math.min(s.min[k], c); s.max[k] = Math.max(s.max[k], c); } }
      });
      await new Promise(r => setTimeout(r, ms)); off?.();
      return { frames, speed, people: [...out].map(([key, s]) => ({ key, n: s.n, spread: Math.max(...s.max.map((x, k) => x - s.min[k])) })) };
    }, [car.id, ms]);
    // drive off: the throttle held (a straight run, then the brakes)
    const drive = async (ms, shots) => {
      await page.bringToFront(); await page.keyboard.down('KeyW');
      const t0 = Date.now(); let k = 0;
      const samp = sample(page, ms - 300), samp2 = sample(page2, ms - 300);
      while (Date.now() - t0 < ms) { await sleep(250); if (shots && shots[k] && Date.now() - t0 > shots[k][0]) { await shots[k][1](); k++; } }
      await page.keyboard.up('KeyW');
      return [await samp, await samp2];
    };
    await view(page2, views.side);
    const [own, other] = await drive(7500, [[4500, () => shot(page2, 'p3-moving-side')], [5800, () => shot(page, 'p3-moving-driver-view')]]);
    console.log('    own page', JSON.stringify(own), '\n    watcher', JSON.stringify(other));
    check(own.speed > 12, `it got up to speed (${own.speed.toFixed(1)} m/s)`);
    for (const [who, res] of [['the driver\'s page', own], ['the watcher\'s page', other]]) for (const q of res.people) check(q.spread < 0.02, `${who}: ${q.key} stays in its seat at speed (${(q.spread * 100).toFixed(2)} cm over ${q.n} frames)`);
    await page.keyboard.down('ShiftLeft'); await sleep(2500); await page.keyboard.up('ShiftLeft');
    await view(page2, views.rear34); await sleep(800); await shot(page2, 'p3-stopped-rear34');
    // one companion: the other two let go (they get out beside the car)
    for (const a of ag.slice(1, 3)) await api({ agent: a.id, action: 'dismiss' });
    const one = await waitFor(async () => (await page.evaluate(id => window.__mvw.net.vseats.get(id)?.length || 0, car.id)) === 1, 8000, 300);
    check(!!one, 'two let go: one companion left in the car');
    await sleep(1200);
    o = await occupants(page2);
    check(o.list.filter(q => q.car?.id === car.id).length === 2, `the watcher sees the driver and one passenger (${o.list.filter(q => q.car?.id === car.id).map(q => q.key).join(', ')})`);
    await view(page2, views.side); await sleep(800); await shot(page2, 'p1-rest-side');
    await view(page2, views.top); await sleep(800); await shot(page2, 'p1-rest-top');
    await view(page2, views.side);
    const [own1] = await drive(4200, [[3000, () => shot(page2, 'p1-moving-side')]]);
    for (const q of own1.people) check(q.spread < 0.02, `one passenger: ${q.key} stays in its seat at speed (${(q.spread * 100).toFixed(2)} cm, ${own1.speed.toFixed(1)} m/s)`);
    await page.keyboard.down('ShiftLeft'); await sleep(2500); await page.keyboard.up('ShiftLeft');
    // out of the car: the driver and the companion out beside it, nobody left drawn in it
    const out = await page.evaluate(async () => { try { await window.__mvw.driving.exit(); return 'ok'; } catch (e) { return e.message; } });
    check(out === 'ok', `the owner got out (${out})`);
    const empty = await waitFor(async () => { const q = await occupants(page2); return q.list.filter(x => x.car?.id === car.id).length === 0 ? q : null; }, 8000, 300);
    check(!!empty, 'nobody drawn in the car once they are out');
    await sleep(1500); await view(page2, views.rear34); await sleep(700); await shot(page2, 'p0-out-beside');
    check(O1.errs.length === 0 && O2.errs.length === 0, `no page errors (${[...O1.errs, ...O2.errs].join(' | ')})`);
    await page.context().close(); await page2.context().close();
  }

  async function residentPhase() {
    console.log('— an agent driving its own car');
    // (tools-bin/agent-car-visual-check.mjs in the lab: a Radio Station on the island, an agent posted there, let go: it
    // drives back)
    const { Island } = await import(path.join(ROOT, 'shared/terrain.js'));
    const { RoadNetwork } = await import(path.join(ROOT, 'shared/roads.js'));
    const { checkWorldModule, accessRoadPath } = await import(path.join(ROOT, 'shared/world-modules.js'));
    let w = (await owner.get('/api/world')).json.world;
    const T = w.terrain, island = new Island(T, { roads: w.roads }), net = RoadNetwork.fromJSON(w.roads);
    const env = { heightAt: (x, z) => island.height(x, z), isWater: (x, z) => !!island.waterAt(x, z), roads: net };
    let m = null;
    for (let k = 0; k < 4000 && !m; k++) {
      const a = k * 2.399, rr = T.radius * (0.3 + (k % 7) * 0.08), c = { kind: 'radio', name: 'Far Radio', x: T.center.x + Math.cos(a) * rr, z: T.center.z + Math.sin(a) * rr, rot: (k % 8) * Math.PI / 4 };
      if (checkWorldModule(w, c, env)) continue;
      const pts = accessRoadPath(c, net), um = v => Math.round(v * 1e6);
      const r = await owner.post('/api/edit', { atomic: true, ops: [{ op: 'wmod.add', module: c }, ...(pts ? [{ op: 'road.set', road: { profile: 'country', name: 'Radio Road', pts: pts.map(p => (p.r ? { x: um(p.x), z: um(p.z), r: um(p.r) } : { x: um(p.x), z: um(p.z) })) } }] : [])] });
      if (r.status === 200) m = { ...c, id: r.json.results[0].id };
    }
    check(!!m, 'a Radio Station on the island');
    w = (await owner.get('/api/world')).json.world;
    const B = w.buildings[(w.worldModules || []).find(x => x.id === m?.id)?.terminal];
    const A = (await owner.get('/api/agents')).json.agents.at(-1);
    const items = (await owner.get(`/api/agent-posts/floor?b=${B.idx}&f=0`)).json.items || [];
    const it = items.find(x => x.slots?.length);
    check((await owner.post('/api/agent-posts/here', { agent: A.id, b: B.idx, f: 0, item: it.id, slot: it.slots[0].k })).status === 200, `${A.name} posted at the Radio Station`);
    const O1 = await open('owner', owner.password), page = O1.page;
    await page.evaluate(async i => { const { select } = await import('/js/core/state.js'); window.__mvw.setMode?.('explore'); select(i, { force: true, follow: true }); }, A.i);
    await sleep(1500);
    check((await owner.post('/api/agent-posts/leave', { agent: A.id })).status === 200, 'let go: it drives back to its day');
    const D = await waitFor(() => page.evaluate(i => { const d = [...window.__mvw.residentCars.drives.values()].find(x => x.i === i && x.timed); return d ? { tIn: d.tIn, tOut: d.tOut, ks: d.timed.ks, ts: d.timed.ts, len: d.timed.S.at(-1) } : null; }, A.i), 60000, 500);
    check(!!D, D ? `its drive: ${(D.len / 1000).toFixed(2)} km, ${Math.round(D.tOut - D.tIn)} s at the wheel` : 'it drives');
    if (!D) return;
    const until = async t => { for (;;) { const now = await page.evaluate(() => window.__mvw.S.simT), left = t - now; if (left <= 0) break; await setRate(left > 25 ? 8 : 1); await sleep(Math.min(left > 25 ? 1500 : 200, Math.max(50, left / (left > 25 ? 8 : 1) * 1000))); } await setRate(1); };
    const moving = D.ts.find((t, k) => k > 0 && t > D.tIn + 12 && D.ks[k] - D.ks[k - 1] > 20) ?? (D.tIn + D.tOut) / 2;
    const look = (yaw, pitch, dist) => page.evaluate(([i, yaw, pitch, dist]) => {
      const A = window.__mvw, c = A.cam;
      c.follow = () => { const p = A.carOccupants.placed.get('r' + i); return p ? { x: p.x, y: p.y + 1, z: p.z } : A.agents.pos(i); };
      window.__look = { yaw, pitch, dist };
      if (!window.__lookOn) { window.__lookOn = 1; A.bus.on('preframe', () => { const L = window.__look, p = A.carOccupants.placed.get('r' + i); if (!L || !p) return; c.yaw = c.goalYaw = p.yaw + L.yaw; c.pitch = c.goalPitch = L.pitch; c.dist = c.goalDist = L.dist; }); }
    }, [A.i, yaw, pitch, dist]);
    await until(D.tIn + 2.5);
    await look(Math.PI / 2, 0.12, 5); await sleep(900);
    let o = await page.evaluate(i => window.__mvw.carOccupants.placed.get('r' + i) || null, A.i);
    check(!!o, `${A.name} drawn at the wheel getting in`);
    await shot(page, 'r-getting-in-side');
    await until(moving);
    await look(Math.PI / 2, 0.12, 5); await sleep(700); await shot(page, 'r-driving-side');
    await look(Math.PI * 0.78, 0.3, 6.5); await sleep(700); await shot(page, 'r-driving-rear34');
    await look(0.05, 0.15, 6); await sleep(700); await shot(page, 'r-driving-front');
    // its place in its car's frame, frame by frame, as its car moves
    const res = await page.evaluate(async ([i, ms]) => {
      const A = window.__mvw, THREE = A.THREE, RC = A.residentCars, O = A.carOccupants, m = new THREE.Matrix4(), v = new THREE.Vector3(), min = [9, 9, 9], max = [-9, -9, -9];
      let frames = 0, moved = 0, last = null;
      const off = A.bus.on('postframe', () => {
        // its car as render/resident-cars.js drew it this frame (its first part's instance: the cars in each's order)
        let idx = -1, k = -1, n = [0, 0, 0];
        RC.each(A.S.simT, (D, kk) => { const j = n[kk]++; if (D.i === i) { idx = j; k = kk; } });
        const p = O.placed.get('r' + i); if (idx < 0 || !p) return;
        const meshes = A.stage.scene.getObjectByName('resident-cars').children.filter(x => x.isInstancedMesh && x.count >= 0);
        const im = meshes.find(x => x.geometry === RC.kinds()[k].asset.parts[0].geometry);
        im.getMatrixAt(idx, m); m.invert(); v.set(p.x, p.y, p.z).applyMatrix4(m); frames++;
        if (last) moved += Math.hypot(p.x - last.x, p.z - last.z); last = { x: p.x, z: p.z };
        [v.x, v.y, v.z].forEach((c, q) => { min[q] = Math.min(min[q], c); max[q] = Math.max(max[q], c); });
      });
      await new Promise(r => setTimeout(r, ms)); off?.();
      return { frames, moved, spread: Math.max(...max.map((x, q) => x - min[q])) };
    }, [A.i, 3000]);
    check(res.frames > 20 && res.moved > 5 && res.spread < 0.02, `${A.name} stays at its wheel as its car drives (${(res.spread * 100).toFixed(2)} cm over ${res.frames} frames, ${res.moved.toFixed(0)} m)`);
    await until(D.tOut - 2);
    await look(Math.PI / 2, 0.12, 5); await sleep(700); await shot(page, 'r-getting-out-side');
    await until(D.tOut + 1.5);
    o = await page.evaluate(i => window.__mvw.carOccupants.placed.get('r' + i) || null, A.i);
    check(!o, `${A.name} out of the car: not drawn in it`);
    await page.evaluate(i => { window.__look = null; const c = window.__mvw.cam; c.follow = () => window.__mvw.agents.pos(i); c.goalDist = 9; c.goalPitch = 0.5; }, A.i);
    await sleep(900); await shot(page, 'r-out-walking');
    check(O1.errs.length === 0, `no page errors (${O1.errs.join(' | ')})`);
    await page.context().close();
  }
} finally { await browser?.close(); await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(`${dir}.key`, { force: true }); }
console.log(fails.length ? `${fails.length} failed` : 'all good');
process.exit(fails.length ? 1 : 0);
