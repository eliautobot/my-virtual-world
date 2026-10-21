// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// World modules over HTTP on a real island (docs/features/play-modules.md §Placing modules): only administrators place
// an airport; it needs open, dry, fairly flat land beyond the city, clear of roads, buildings and lots, and a road within
// reach; its pad levels the ground; nothing else is built on it and no road crosses it; it and its access road go in
// together or not at all; undo takes it away. Then a member flies a ring course from it and the prize reaches the wallet.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession, tempDir, ROOT } from './helpers/server.mjs';
import { Island } from '../shared/terrain.js';
import { RoadNetwork } from '../shared/roads.js';
import { checkWorldModule, padOf, roadEndOf, moduleBoxes, aircraftStands, accessRoadPath, accessRoadsOf } from '../shared/world-modules.js';
import { buildingPads } from '../shared/island-build.js';
import { PlayerNav } from '../shared/playernav.js';
import { profileAt, DRAW_LIFT } from '../shared/island-roads.js';
import { COURSE_BY_ID } from '../shared/airport.js';

let s, owner, alice, spot = null; const spots = [];
const edit = (c, ops, o = {}) => c.post('/api/edit', { ops, ...o });
const world = async () => (await owner.get('/api/world')).json.world;
before(async () => {
  const dir = tempDir('mvw-wmod-');
  const first = await startServer({ data: dir, population: 100 }); await first.stop();
  for (const tool of ['add-island', 'add-roads']) {
    const r = spawnSync(process.execPath, [`tools/wp4/${tool}.mjs`, '--data', dir, '--server-stopped'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  s = await startServer({ data: dir, population: 100 });
  owner = await ownerSession(s); alice = await userSession(s, owner, { login: 'alice', displayName: 'Alice' });
  // an open spot for an airport, found with the same rules the server uses
  const w = await world(), T = w.terrain, island = new Island(T, { roads: w.roads }), net = RoadNetwork.fromJSON(w.roads);
  const env = { heightAt: (x, z) => island.height(x, z), isWater: (x, z) => !!island.waterAt(x, z), roads: net };
  for (let k = 0; k < 3000 && spots.length < 8; k++) {   // (more than one: the move test takes it to another, far off)
    const a = k * 2.399, rr = T.radius * (0.15 + (k % 11) * 0.06), m = { kind: 'airport', x: T.center.x + Math.cos(a) * rr, z: T.center.z + Math.sin(a) * rr, rot: (k % 8) * Math.PI / 4 };
    if (!checkWorldModule(w, m, env) && spots.every(o => Math.hypot(o.x - m.x, o.z - m.z) > 1500)) spots.push(m);
  }
  spot = spots[0] || null;
});
after(async () => { await s?.stop(); });

test('only administrators place an airport; it levels its land and keeps everything else off it; undo and redo', async () => {
  assert.ok(spot, 'an open spot on the island for an airport');
  assert.equal((await edit(alice, [{ op: 'wmod.add', module: spot }])).status, 403, 'members do not place world modules');
  const city = await edit(owner, [{ op: 'wmod.add', module: { kind: 'airport', x: 0, z: 0, rot: 0 } }]);
  assert.equal(city.status, 400); assert.match(city.json.error, /city/);
  const r = await edit(owner, [{ op: 'wmod.add', module: spot }]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  let w = await world();
  const m = w.worldModules[0];
  assert.equal(m.kind, 'airport'); assert.match(m.name, /Airport/); assert.ok(Number.isFinite(m.y));
  assert.ok(buildingPads(w).some(p => Math.abs(p.hd - 436) < 1e-6), 'its pad levels the ground');
  const isl = new Island(w.terrain, { roads: w.roads }).withPads(buildingPads(w));
  assert.ok(Math.abs(isl.height(m.x, m.z) - m.y) < 0.1, 'the runway is level');
  assert.equal(moduleBoxes(w).length, 12, 'the tower, the hangar and the canopy\'s ten columns (the terminal is a building)'); assert.equal(aircraftStands(w).length, 10);
  { // the terminal: a real building of the airport's, two floors, check-in below and the gates above, its door to the car park
    const T = w.buildings[m.terminal];
    assert.ok(T && !T.gone && T.type === 'terminal' && T.module === m.id && T.floors === 2, 'the airport has its terminal');
    const lv0 = w.levels[T.lv[0]], lv1 = w.levels[T.lv[1]];
    assert.ok(lv0.items.some(i => i.t === 'security_arch') && lv0.items.some(i => i.t === 'baggage_belt') && lv0.items.filter(i => i.t === 'reception').length >= 6, 'check-in, security and baggage below');
    assert.ok(lv1.items.some(i => i.t === 'cafe_counter') && lv1.items.filter(i => i.t === 'bench').length >= 12 && lv1.venue === 'cafe', 'gates and a café above');
    const door = roadEndOf(m); assert.ok(Math.hypot(T.x + Math.sin((T.rot || 0) * Math.PI / 180) * T.d / 2 - door.x, T.z + Math.cos((T.rot || 0) * Math.PI / 180) * T.d / 2 - door.z) < 60, 'its door faces the car park');
  }
  assert.deepEqual(aircraftStands(w).reduce((o, a) => ({ ...o, [a.type]: (o[a.type] || 0) + 1 }), {}), { prop: 3, jet: 3, heli: 4 });
  { // nobody walks through a standing aircraft or the terminal (the server's own check of where players go)
    const nav = new PlayerNav(w, { ground: true }), st = aircraftStands(w)[3], t = moduleBoxes(w)[0];
    assert.equal(nav.outsideOk(st.x, st.z), false, 'a jet is solid'); assert.equal(nav.outsideOk(t.x, t.z), false, 'the terminal is solid');
    assert.equal(nav.outsideOk(st.x + Math.sin(st.yaw + Math.PI / 2) * 9, st.z + Math.cos(st.yaw + Math.PI / 2) * 9), true, 'beside it is open');
    // the access road's end is level with the car park (the pad is levelled to it)
    const e = roadEndOf(m); assert.ok(Math.abs(isl.height(e.x, e.z) - m.y) < 0.3, `the road end ${isl.height(e.x, e.z).toFixed(2)} vs the pad ${m.y}`);
  }
  // a second one on top of it, a station on it, a road through it: refused
  assert.match((await edit(owner, [{ op: 'wmod.add', module: spot }])).json.error, /Too close|in the way/);
  assert.match((await edit(owner, [{ op: 'station.add', station: { x: m.x, z: m.z, rot: 0 } }])).json.error, /land/);
  const pad = padOf(m), um = v => Math.round(v * 1e6), dx = Math.sin(m.rot + Math.PI / 2) * 600, dz = Math.cos(m.rot + Math.PI / 2) * 600;
  const through = await edit(owner, [{ op: 'road.set', road: { profile: 'country', pts: [{ x: um(pad.x - dx), z: um(pad.z - dz) }, { x: um(pad.x + dx), z: um(pad.z + dz) }] } }]);
  assert.equal(through.status, 400); assert.match(through.json.error, /crosses|water|land/);
  // rename; undo the rename, then undo the airport
  assert.equal((await edit(owner, [{ op: 'wmod.set', id: m.id, name: 'Sky Harbour' }])).status, 200);
  { const w2 = await world(), T = w2.buildings[m.terminal]; assert.equal(w2.worldModules[0].name, 'Sky Harbour'); assert.deepEqual([T.name, T.sign], ['Sky Harbour', 'Sky Harbour'], 'the terminal takes the airport\'s name'); }
  // one name: renaming the terminal (its name or its sign) renames the airport — canopy and entrance sign — in one undo
  assert.equal((await edit(owner, [{ op: 'bld.set', b: m.terminal, name: 'Gulf Coast Intl' }])).status, 200);
  { const w2 = await world(), T = w2.buildings[m.terminal]; assert.deepEqual([w2.worldModules[0].name, T.name, T.sign], ['Gulf Coast Intl', 'Gulf Coast Intl', 'Gulf Coast Intl']); }
  assert.equal((await edit(owner, [{ op: 'bld.set', b: m.terminal, sign: 'Bay Field' }])).status, 200);
  { const w2 = await world(), T = w2.buildings[m.terminal]; assert.deepEqual([w2.worldModules[0].name, T.name, T.sign], ['Bay Field', 'Bay Field', 'Bay Field']); }
  for (let i = 0; i < 2; i++) { const u = await owner.post('/api/undo', {}); assert.equal(u.status, 200, JSON.stringify(u.json)); }
  { const w2 = await world(), T = w2.buildings[m.terminal]; assert.deepEqual([w2.worldModules[0].name, T.name, T.sign], ['Sky Harbour', 'Sky Harbour', 'Sky Harbour'], 'undo puts both back'); }
  { const u = await owner.post('/api/undo', {}); assert.equal(u.status, 200, JSON.stringify(u.json)); }
  { const w2 = await world(), T = w2.buildings[m.terminal]; assert.equal(w2.worldModules[0].name, m.name); assert.equal(T.name, m.name); }
  { const u = await owner.post('/api/undo', {}); assert.equal(u.status, 200, JSON.stringify(u.json)); }
  assert.equal((await world()).worldModules.length, 0, 'undo takes the airport away');
  assert.ok((await world()).buildings[m.terminal]?.gone, 'and its terminal');
  assert.equal((await owner.post('/api/redo', {})).status, 200);
  w = await world(); assert.equal(w.worldModules.length, 1, 'redo brings it back');
  assert.ok(!w.buildings[m.terminal].gone, 'its terminal too');
  assert.equal((await edit(alice, [{ op: 'wmod.del', id: m.id }])).status, 403);
});

test('an airport and its access road go in together, or neither does', async () => {
  let w = await world();
  const m = w.worldModules[0];
  assert.equal((await edit(owner, [{ op: 'wmod.del', id: m.id }])).status, 200);
  assert.ok((await world()).buildings[m.terminal].gone, 'closing the airport closes its terminal');
  const net = RoadNetwork.fromJSON(w.roads), e = roadEndOf(spot), near = net.nearest(e.x, e.z, 1500), um = v => Math.round(v * 1e6);
  // an access road that can't be built (it runs into the sea) takes the airport with it
  const bad = await edit(owner, [{ op: 'wmod.add', module: spot }, { op: 'road.set', road: { profile: 'country', pts: [{ x: um(e.x), z: um(e.z) }, { x: um(e.x + 20000), z: um(e.z) }] } }], { atomic: true });
  assert.equal(bad.status, 400);
  assert.equal((await world()).worldModules.length, 0, 'nothing placed');
  assert.ok(near, 'a road within reach');
  // the access road as the World modules tool lays it: square out of its entrance, round to the nearest road
  const road = pts => ({ op: 'road.set', road: { profile: 'country', name: 'Airport Road', pts: pts.map(p => (p.r ? { x: um(p.x), z: um(p.z), r: um(p.r) } : { x: um(p.x), z: um(p.z) })) } });
  const pts = accessRoadPath(spot, net);
  const ok = await edit(owner, [{ op: 'wmod.add', module: spot }, ...(pts ? [road(pts)] : [])], { atomic: true });
  w = await world();
  if (ok.status === 200) { assert.equal(w.worldModules.length, 1); if (pts) assert.equal(accessRoadsOf(w, w.worldModules[0]).length, 1, 'the access road, from its entrance'); }
  else { assert.equal(w.worldModules.length, 0, `refused together: ${ok.json.error}`); assert.equal((await edit(owner, [{ op: 'wmod.add', module: spot }])).status, 200); w = await world(); }
  // the airport meets its access road level: its paving's top (3.5 cm under its level) flush with the road's top where
  // they meet (a road meeting it lower than the land it was levelled to started buried, 2026-10-14)
  const flush = (W, what) => {
    const m = W.worldModules[0], r = accessRoadsOf(W, m)[0]; if (!r) return;
    const R = new Island(W.terrain, { roads: W.roads, pads: buildingPads(W) }).roads, e = roadEndOf(m), first = Math.hypot(r.pts[0].x / 1e6 - e.x, r.pts[0].z / 1e6 - e.z) < 3;
    const top = profileAt(R.prof.get(r.id), first ? 0 : R.net.geometry(r.id).length) + DRAW_LIFT;
    assert.ok(Math.abs(m.y - 0.035 - top) < 0.03, `${what}: the airport's paving ${(m.y - 0.035).toFixed(2)} meets its road's top ${top.toFixed(2)}`);
  };
  flush(w, 'placed');
  // moved: its old access road goes, a new one comes — in one edit, the old one first (it would cross where it now stands)
  const cur = w.worldModules[0], olds = accessRoadsOf(w, cur), island = new Island(w.terrain, { roads: w.roads });
  const env = { heightAt: (x, z) => island.height(x, z), isWater: (x, z) => !!island.waterAt(x, z), roads: RoadNetwork.fromJSON(w.roads.filter(r => !olds.some(o => o.id === r.id))) };
  // (somewhere close by the server takes: it is the judge — its ground has the airport's own pad, the client's check not)
  let moved = null; const why = [];
  for (const sp of spots.slice(1)) {   // another open place, far off
    const to = { ...cur, x: sp.x, z: sp.z, rot: sp.rot }, ds = Math.round(sp.x), df = Math.round(sp.z);
    { const c = checkWorldModule(w, to, env, { ignoreId: cur.id }); if (c) { why.push(`(${ds},${df}) client: ${c}`); continue; } }
    const p2 = accessRoadPath(to, env.roads);
    const mv = await edit(owner, [...olds.map(r => ({ op: 'road.del', id: r.id })), { op: 'wmod.set', id: cur.id, x: to.x, z: to.z, rot: to.rot }, ...(p2 ? [road(p2)] : [])], { atomic: true });
    const w2 = await world();
    if (mv.status === 200) { moved = { w2, p2 }; break; }
    why.push(`(${ds},${df}) server: ${mv.json.error}`);
    assert.equal(w2.worldModules[0].x, cur.x, 'refused: nothing moved'); assert.equal(accessRoadsOf(w2, cur).length, olds.length, `refused (${mv.json.error}): its road kept`);
  }
  assert.ok(moved, `it moved somewhere close by: ${why.join(' | ')}`);
  assert.equal(accessRoadsOf(moved.w2, cur).length, 0, 'no road ends where its entrance was: the old access road is gone');
  assert.equal(accessRoadsOf(moved.w2, moved.w2.worldModules[0]).length, moved.p2 ? 1 : 0, 'a new one from where its entrance now is');
  flush(moved.w2, 'moved');
});

test('a member flies a course from the airport and the prize reaches the wallet (the real ledger)', async () => {
  assert.equal((await owner.post('/api/economy/admin/switch', { name: 'enabled', on: true })).status, 200);
  const st = await alice.post('/api/play/start', { module: 'airport', course: 'first-flight' });
  assert.equal(st.status, 200, JSON.stringify(st.json));
  const t0 = Date.now(), rings = st.json.data.rings, w = await world(), m = w.worldModules[0];
  assert.equal(rings.length, COURSE_BY_ID['first-flight'].n); assert.equal(st.json.data.airport.id, m.id);
  for (const r of rings) assert.ok(r.y > m.y + r.r, 'every ring is above the airfield');
  const before = (await alice.get('/api/economy/me')).json.wallet.balance;
  // through the rings at 95 m/s (as fast as a propeller plane may be reported in a dive), four samples a second
  const v = 95, pts = [], g = rings[0]; let t = 0;
  const way = [{ x: g.x - g.nx * 100, y: g.y, z: g.z - g.nz * 100 }, ...rings.flatMap(r => [{ x: r.x - r.nx * 6, y: r.y, z: r.z - r.nz * 6 }, { x: r.x + r.nx * 6, y: r.y, z: r.z + r.nz * 6 }])];
  pts.push([0, way[0].x, way[0].y, way[0].z]);
  for (let k = 1; k < way.length; k++) {
    const a = way[k - 1], b = way[k], L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), n = Math.max(1, Math.ceil(L / v * 4));
    for (let j = 1; j <= n; j++) { t += L / v / n * 1000; pts.push([Math.round(t), a.x + (b.x - a.x) * j / n, a.y + (b.y - a.y) * j / n, a.z + (b.z - a.z) * j / n]); }
  }
  const early = await alice.post('/api/play/finish', { run: st.json.run, report: { aircraft: 'prop', path: pts } });
  assert.equal(early.json.ok, false, 'reported before the clock allows'); assert.match(early.json.why, /longer than the clock/);
  // again, reported when the flight could really have ended
  await new Promise(r => setTimeout(r, 1600));
  const st2 = await alice.post('/api/play/start', { module: 'airport', course: 'first-flight' });
  assert.equal(st2.status, 200);
  const wait = t - 3500 - 0; await new Promise(r => setTimeout(r, Math.max(0, wait)));
  const done = await alice.post('/api/play/finish', { run: st2.json.run, report: { aircraft: 'prop', path: pts } });
  assert.equal(done.json.ok, true, JSON.stringify(done.json));
  assert.equal(done.json.stars, 3); assert.equal(done.json.place, 1);
  assert.equal(done.json.vc.amount, 2100); assert.equal(done.json.vc.paid, 2100, '21 VC: a first three-star record on First Flight');
  const after = (await alice.get('/api/economy/me')).json.wallet.balance;
  assert.equal(after - before, 2100, 'the prize is in the wallet');
  assert.ok(Date.now() - t0 < 60000);
});

test('flying: walk up to a jet and board it, its poses are checked (a jump is refused), nobody else takes it, everyone hears of it; out when stopped', async () => {
  const w = await world(), jet = aircraftStands(w).find(a => a.type === 'jet');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const conn = client => {
    const ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: client.cookie } });
    const c = { ws, msgs: [] };
    ws.onmessage = e => { if (typeof e.data === 'string') c.msgs.push(JSON.parse(e.data)); };
    c.opened = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
    c.send = o => ws.send(JSON.stringify(o));
    c.msg = async (pred, ms = 6000) => { const t0 = Date.now(); for (;;) { const m = c.msgs.find(pred); if (m) return m; if (Date.now() - t0 > ms) return null; await sleep(30); } };
    return c;
  };
  const o = conn(owner), al = conn(alice);
  await Promise.all([o.opened, al.opened]);
  await Promise.all([o.msg(m => m.t === 'you'), al.msg(m => m.t === 'you')]);
  o.send({ t: 'pobserve', on: false }); al.send({ t: 'pobserve', on: false });
  // too far: refused
  o.send({ t: 'fboard', id: jet.id });
  assert.match((await o.msg(m => m.t === 'fstate')).text, /Walk up to it/);
  // beside it (a warp: the owner is an administrator), then aboard
  const side = { x: jet.x + Math.cos(jet.yaw) * 7.5, z: jet.z - Math.sin(jet.yaw) * 7.5 };
  o.send({ t: 'pwarp', x: side.x, z: side.z, ctx: -1 }); await sleep(300);
  o.msgs.length = 0;
  o.send({ t: 'fboard', id: jet.id });
  const st = await o.msg(m => m.t === 'fstate');
  assert.equal(st.ok, true, st.text); assert.equal(st.type, 'jet');
  // somebody else can't take it
  al.send({ t: 'fboard', id: jet.id });
  assert.match((await al.msg(m => m.t === 'fstate')).text, /flying it|Walk up/);
  // taxi forward: poses accepted, the others hear it is away
  const h = jet.yaw, q = [0, Math.sin(h / 2), 0, Math.cos(h / 2)];
  let x = st.pose.x, z = st.pose.z;
  for (let k = 0; k < 6; k++) { x += Math.sin(h) * 1.5; z += Math.cos(h) * 1.5; o.send({ t: 'fpose', x, y: st.pose.y, z, q, v: 2, g: 1 }); await sleep(110); }
  const fl = await al.msg(m => m.t === 'fleet' && m.away.includes(jet.id));
  assert.ok(fl, 'everyone hears the jet is away from its stand');
  assert.ok(fl.near.some(r => r[0] === jet.id && r[1] === 'jet'), 'and nearby players get its pose');
  // a jump of 2 km in a tenth of a second: refused, the pilot corrected
  o.send({ t: 'fpose', x: x + 2000, y: st.pose.y, z, q, v: 2, g: 1 });
  assert.ok(await o.msg(m => m.t === 'fcorr'), 'refused and corrected');
  // moving: can't get out; stopped: out beside it, and so close to its stand it goes back onto it
  o.send({ t: 'fpose', x, y: st.pose.y, z, q, v: 20, g: 1 }); await sleep(120);
  o.send({ t: 'fexit' });
  assert.match((await o.msg(m => m.t === 'fstate' && m.ok === false && /Stop/.test(m.text))).text, /Stop first/);
  o.send({ t: 'fpose', x, y: st.pose.y, z, q, v: 0, g: 1 }); await sleep(120);
  o.send({ t: 'fexit' });
  const out = await o.msg(m => m.t === 'pmoved' && m.flight === 'out');
  assert.ok(out, 'out of the jet');
  assert.ok(Math.hypot(out.x - x, out.z - z) < 8, 'standing beside it');
  const back = await al.msg(m => m.t === 'fleet' && !m.away.includes(jet.id), 4000);
  // leaving Play mode in the air: out of the cockpit, beside its stand, the aircraft home
  o.send({ t: 'pwarp', x: side.x, z: side.z, ctx: -1 }); await sleep(300);
  o.msgs.length = 0;
  o.send({ t: 'fboard', id: jet.id });
  const st2 = await o.msg(m => m.t === 'fstate' && m.ok);
  assert.ok(st2, 'aboard again');
  await sleep(700); o.send({ t: 'fpose', x: st2.pose.x, y: st2.pose.y + 30, z: st2.pose.z, q, v: 60, g: 0 }); await sleep(150);   // (30 m up in 0.7 s: within what a jet does)
  // poses arriving together (the pilot's phone or the server stalled) are judged by the flight's own clock (ts): 45 m in
  // its half second, sent at once — accepted (by the time they arrived, 45 m in no time: refused, the jet stopped dead)
  await sleep(1200); o.msgs.length = 0;
  let px = st2.pose.x, pz = st2.pose.z;
  o.send({ t: 'fpose', ts: 0.1, x: px, y: st2.pose.y + 20, z: pz, q, v: 90, g: 0 });
  for (const ts of [0.6, 1.1]) { px += Math.sin(h) * 45; pz += Math.cos(h) * 45; o.send({ t: 'fpose', ts, x: px, y: st2.pose.y + 20, z: pz, q, v: 90, g: 0 }); }
  await sleep(400);
  assert.ok(!o.msgs.some(m => m.t === 'fcorr'), 'poses arriving together, half a second apart on their own clock: accepted');
  // its clock can't run ahead of the real one: a minute claimed a moment later, 5 km on — refused
  o.send({ t: 'fpose', ts: 61.1, x: px + Math.sin(h) * 5000, y: st2.pose.y + 20, z: pz + Math.cos(h) * 5000, q, v: 90, g: 0 });
  assert.ok(await o.msg(m => m.t === 'fcorr'), 'a clock running ahead is not believed');
  o.send({ t: 'fleave' });
  const left = await o.msg(m => m.t === 'pmoved' && m.flight === 'out');
  assert.ok(left && /ground crew/.test(left.text), `left the cockpit in the air: ${left?.text}`);
  assert.ok(Math.hypot(left.x - jet.x, left.z - jet.z) < 20, 'set down beside the stand');
  assert.ok(back, 'and it is back on its stand');
  o.ws.close(); al.ws.close();
});
