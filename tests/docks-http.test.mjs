// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The fishing docks over HTTP on a real island (docs/features/fishing.md §Venues): an administrator places a marina at a
// shore the placing tool fits it to; the server takes the water's level, levels the land just above it, makes the dock
// store (a real building: a shop with a tackle counter) in the same edit, and undo
// takes it all away; a lake dock goes on a lake; a member can't place one; a player on the pier is on its deck.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession, tempDir, ROOT } from './helpers/server.mjs';
import { Island } from '../shared/terrain.js';
import { RoadNetwork } from '../shared/roads.js';
import { checkWorldModule, moduleDecks, deckUnder } from '../shared/world-modules.js';
import { fitToShore, DOCKS } from '../shared/dock-layout.js';
import { coastline, protectedWhy } from '../shared/coasts.js';
import { buildingPads } from '../shared/island-build.js';

let s, owner, alice;
const edit = (c, ops, o = {}) => c.post('/api/edit', { ops, ...o });
const world = async () => (await owner.get('/api/world')).json.world;
/** Shores a dock of this kind fits at (the placing tool's fit, the server's rules). */
async function spotsFor(kind, n = 3) {
  const w = await world(), T = w.terrain, island = new Island(T, { roads: w.roads }).withPads(buildingPads(w)), net = RoadNetwork.fromJSON(w.roads);
  const env = { heightAt: (x, z) => island.height(x, z), isWater: (x, z) => !!island.waterAt(x, z), waterAt: (x, z) => island.waterAt(x, z), coastWhy: (x, z) => protectedWhy(island, x, z, 0), roads: net };
  const tries = [], out = [];
  if (kind === 'marina') for (const c of coastline(island)) { const dx = c.x - T.center.x, dz = c.z - T.center.z, d = Math.hypot(dx, dz); for (const back of [20, 40]) tries.push([c.x - dx / d * back, c.z - dz / d * back]); }
  else for (const k of island.lakes) if (!k.frozen && !k.tarn) for (let a = 0; a < 12; a++) tries.push([k.x + Math.cos(a * Math.PI / 6) * k.r * 1.3, k.z + Math.sin(a * Math.PI / 6) * k.r * 1.3]);
  for (const [x, z] of tries) {
    const fit = fitToShore(kind, x, z, env); if (!fit) continue;
    const m = { kind, ...fit };
    if (!checkWorldModule(w, m, env) && out.every(o => Math.hypot(o.x - m.x, o.z - m.z) > 400)) out.push(m);
    if (out.length >= n) break;
  }
  return out;
}
before(async () => {
  const dir = tempDir('mvw-docks-');
  const first = await startServer({ data: dir, population: 80 }); await first.stop();
  for (const tool of ['add-island', 'add-roads']) {
    const r = spawnSync(process.execPath, [`tools/wp4/${tool}.mjs`, '--data', dir, '--server-stopped'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  s = await startServer({ data: dir, population: 80 });
  owner = await ownerSession(s); alice = await userSession(s, owner, { login: 'alice', displayName: 'Alice' });
});
after(async () => { await s?.stop(); });

test('a marina: placed at the shore with its store, levelled just above the sea, kept clear, undone', async () => {
  const [spot] = await spotsFor('marina');
  assert.ok(spot, 'a shore on the island for a marina');
  assert.equal((await edit(alice, [{ op: 'wmod.add', module: spot }])).status, 403, 'members do not place world modules');
  assert.match((await edit(owner, [{ op: 'wmod.add', module: { ...spot, rot: spot.rot + Math.PI } }])).json.error || '', /over the sea|dry land|water/, 'turned away from the sea: refused');
  const r = await edit(owner, [{ op: 'wmod.add', module: spot }]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  let w = await world();
  const m = w.worldModules.find(x => x.kind === 'marina');
  assert.match(m.name, /Marina$/); assert.equal(m.wy, w.terrain.seaLevel ?? -2.4);
  assert.ok(m.y >= m.wy + DOCKS.marina.above[0] - 1e-6 && m.y <= m.wy + DOCKS.marina.above[1] + 1e-6, `its land ${(m.y - m.wy).toFixed(2)} m over the sea`);
  const B = w.buildings[m.terminal];
  assert.ok(B && B.type === 'shop' && B.tackle && B.module === m.id && /Dock Store$/.test(B.name), `its store: ${B?.name}`);
  // its benches, picnic tables and trees: the world's own decorations (people sit on them), marked as the dock's
  const own = (w.decorations || []).filter(d => d.mod === m.id), P = DOCKS.marina.plan;
  assert.equal(own.length, P.benches.length + P.picnic.length + P.trees.length, `its decorations: ${own.length}`);
  assert.ok(own.filter(d => d.t === 'bench').length === P.benches.length && own.some(d => d.t === 'picnic_table') && own.some(d => d.t === 'tree'));
  // the pier is stood on: its deck under a body at its height, the water under a swimmer
  const decks = moduleDecks(w), pier = decks.find(d => d.kind === 'pier' && d.y0 === d.y1);
  assert.equal(deckUnder(decks, pier.x, pier.z, m.wy + 1.6), m.wy + 1.6);
  const u = await owner.post('/api/undo', {}); assert.equal(u.status, 200, JSON.stringify(u.json));
  w = await world();
  assert.ok(!w.worldModules.some(x => x.kind === 'marina'), 'undone'); assert.ok(!w.buildings[m.terminal] || w.buildings[m.terminal].gone, 'its store with it');
  assert.ok(!(w.decorations || []).some(d => d.mod === m.id), 'and its benches and trees');
});

test('a lake dock goes on a lake', async () => {
  const [spot] = await spotsFor('lakedock');
  assert.ok(spot, 'a lake shore on the island');
  const r = await edit(owner, [{ op: 'wmod.add', module: spot }]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const w = await world(), m = w.worldModules.find(x => x.kind === 'lakedock');
  assert.ok(m.lake && Number.isFinite(m.wy), `on ${m.lake} at ${m.wy.toFixed(2)}`);
  assert.ok(m.y - m.wy >= DOCKS.lakedock.above[0] - 1e-6 && m.y - m.wy <= DOCKS.lakedock.above[1] + 1e-6, `land ${m.y} water ${m.wy}`);
  assert.equal(w.buildings[m.terminal]?.sign, 'Bait Shack');
});

test('a boat: taken from its slip on the dock, its poses checked (a jump refused), everyone near hears of it, stepped off when stopped', async () => {
  const [spot] = await spotsFor('marina');
  assert.ok(spot);
  assert.equal((await edit(owner, [{ op: 'wmod.add', module: spot }])).status, 200);
  const w = await world(), { boatSlips } = await import('../shared/world-modules.js'), slip = boatSlips(w).find(s => s.kind === 'coastal');
  assert.ok(slip, 'the marina has its boats');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const conn = client => {
    const ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: client.cookie } }), c = { ws, msgs: [] };
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
  o.send({ t: 'bboard', id: slip.id });
  assert.match((await o.msg(m => m.t === 'bstate')).text, /Walk down/, 'too far: refused');
  o.send({ t: 'pwarp', x: slip.deck.x, z: slip.deck.z, ctx: -1 }); await sleep(300);
  o.msgs.length = 0;
  o.send({ t: 'bboard', id: slip.id });
  const st = await o.msg(m => m.t === 'bstate');
  assert.equal(st?.ok, true, st?.text); assert.equal(st.type, 'coastal');
  al.send({ t: 'bboard', id: slip.id });
  assert.match((await al.msg(m => m.t === 'bstate')).text, /has it out|Walk down/, 'nobody else takes it');
  // out of the slip: poses accepted, the others hear it is out
  const h = st.pose.h; let x = st.pose.x, z = st.pose.z;
  for (let k = 0; k < 6; k++) { x += Math.sin(h) * 0.8; z += Math.cos(h) * 0.8; o.send({ t: 'bpose', x, y: st.pose.y, z, h, p: 0, r: 0, v: 4, l: 0.3 }); await sleep(110); }
  const hb = await al.msg(m => m.t === 'harbour' && m.away.includes(slip.id));
  assert.ok(hb && hb.near.some(r => r[0] === slip.id && r[1] === 'coastal'), 'everyone near hears it is out, with its pose');
  o.send({ t: 'bpose', x: x + 900, y: st.pose.y, z, h, v: 4 });
  assert.ok(await o.msg(m => m.t === 'bcorr'), 'a jump of 900 m: refused and corrected');
  o.send({ t: 'bpose', x, y: st.pose.y, z, h, v: 6 }); await sleep(120);
  o.send({ t: 'bexit' });
  assert.match((await o.msg(m => m.t === 'bstate' && m.ok === false)).text, /Stop first/, 'moving: can\'t step off');
  // stopped back beside its slip: off on to the dock, the boat back in
  o.send({ t: 'bpose', x: st.pose.x, y: st.pose.y, z: st.pose.z, h, v: 0 }); await sleep(150);
  o.send({ t: 'bexit' });
  const out = await o.msg(m => m.t === 'pmoved' && m.boat === 'out');
  assert.ok(out, 'off the boat');
  const decks = moduleDecks(w), top = deckUnder(decks, out.x, out.z, out.y + 0.5, 1);
  assert.ok(top !== null && Math.abs(top - out.y) < 0.05, `standing on the dock (${out.y.toFixed(2)})`);
  assert.ok(await al.msg(m => m.t === 'harbour' && !m.away.includes(slip.id), 4000), 'the boat back in its slip');
  o.ws.close(); al.ws.close();
});

test('a fishing trip from a marina: its grounds laid out on that sea, the starter kit; a lake trip refused there; a hook rolled by the server', async () => {
  let w = await world(), m = (w.worldModules || []).find(x => x.kind === 'marina');
  if (!m) { const [spot] = await spotsFor('marina'); assert.equal((await edit(owner, [{ op: 'wmod.add', module: spot }])).status, 200); w = await world(); m = w.worldModules.find(x => x.kind === 'marina'); }
  const r = await owner.post('/api/play/start', { module: 'fishing', course: 'harbour-morning', where: m.id });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data, island = new Island(w.terrain, { roads: w.roads });
  assert.equal(d.dock.id, m.id); assert.equal(d.plan.water, 'sea');
  assert.ok(d.plan.grounds.length >= 3, `${d.plan.grounds.length} grounds`);
  for (const g of d.plan.grounds) {
    const wq = island.waterAt(g.x, g.z);
    assert.ok(wq?.kind === 'sea' && Math.hypot(g.x - d.dock.x, g.z - d.dock.z) <= 700 + 1, `ground ${g.kind} on the sea within the trip's reach`);
  }
  assert.ok(d.clock.hour0 < 8 && d.clock.perMin > 0.5, 'the trip\'s own day, dawn to dusk');
  assert.equal(d.kit.rod, 'rod_starter');
  const gap = () => new Promise(res => setTimeout(res, 1600));   // (one start every 1.5 s)
  await gap();
  const lk = await owner.post('/api/play/start', { module: 'fishing', course: 'lily-pads', where: m.id });
  assert.ok(lk.status === 409 || lk.status === 403, `a lake trip at a marina: ${lk.status}`);
  await gap();
  const again = await owner.post('/api/play/start', { module: 'fishing', course: 'harbour-morning', where: m.id });
  const run = again.json.run, g = again.json.data.plan.grounds[0];
  const h = await owner.post('/api/play/act', { run, act: 'hook', body: { lure: 'shrimp', ground: g.id, d0: 15 } });
  assert.equal(h.status, 200, JSON.stringify(h.json));
  assert.ok(h.json.hook === null || (h.json.what && Number.isFinite(h.json.seed)), 'something took it, or nothing did');
  const quick = await owner.post('/api/play/act', { run, act: 'hook', body: { lure: 'shrimp', ground: g.id, d0: 15 } });
  assert.equal(quick.status, 429, 'two hooks a moment apart: refused');
  const bad = await owner.post('/api/play/act', { run, act: 'hook', body: { lure: 'worm', d0: 15 } });
  assert.ok(bad.status >= 400, 'a lake bait on the sea: refused');
  if (h.json.hook) {
    const land = await owner.post('/api/play/act', { run, act: 'land', body: { hook: h.json.hook } });
    assert.ok(land.status === 422 || h.json.what.kind === 'find', 'landed at once: too fast');
  }
  const fin = await owner.post('/api/play/finish', { run, report: {} });
  assert.equal(fin.status, 200); assert.ok(fin.json.ok === true || fin.json.ok === false);
});

test('a lake trip from a lake dock: its grounds on that lake', async () => {
  let w = await world(), m = (w.worldModules || []).find(x => x.kind === 'lakedock');
  if (!m) { const [spot] = await spotsFor('lakedock'); assert.ok(spot, 'a lake to put a dock on'); assert.equal((await edit(owner, [{ op: 'wmod.add', module: spot }])).status, 200); w = await world(); m = w.worldModules.find(x => x.kind === 'lakedock'); }
  // (a trip starts from the dock you're at: over there first — on a big island the lake can be far from the marina)
  const ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: owner.cookie } }), msgs = [];
  ws.onmessage = e => { if (typeof e.data === 'string') msgs.push(JSON.parse(e.data)); };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  for (let k = 0; k < 100 && !msgs.some(x => x.t === 'you'); k++) await new Promise(res => setTimeout(res, 30));
  ws.send(JSON.stringify({ t: 'pobserve', on: false })); ws.send(JSON.stringify({ t: 'pwarp', x: m.x, z: m.z, ctx: -1 }));
  await new Promise(res => setTimeout(res, 1600));
  const r = await owner.post('/api/play/start', { module: 'fishing', course: 'lily-pads', where: m.id });
  ws.close();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data, island = new Island(w.terrain, { roads: w.roads });
  assert.equal(d.plan.water, 'lake');
  assert.ok(d.plan.grounds.length >= 3, `${d.plan.grounds.length} grounds`);
  const lakes = new Set(d.plan.grounds.map(g => island.waterAt(g.x, g.z)?.id));
  assert.equal(lakes.size, 1, 'every ground on the one lake');
  assert.ok(d.plan.grounds.every(g => island.waterAt(g.x, g.z)?.kind === 'lake'));
  await owner.post('/api/play/abandon', { run: r.json.run });
});

test('the fish market: a trip\'s catch goes into the inventory; the dock store buys it once — not from out on the water', async () => {
  const { kitFor } = await import('../shared/fishing.js'), { STARTER } = await import('../shared/fishing-gear.js'), { minFightSeconds } = await import('../shared/fishing-fight.js'), { speciesOf } = await import('../shared/fish-species.js');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let w = await world(), m = (w.worldModules || []).find(x => x.kind === 'marina');
  if (!m) { const [spot] = await spotsFor('marina'); assert.equal((await edit(owner, [{ op: 'wmod.add', module: spot }])).status, 200); w = await world(); m = w.worldModules.find(x => x.kind === 'marina'); }
  assert.equal((await owner.post('/api/economy/admin/switch', { name: 'enabled', on: true })).status, 200);
  const ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: owner.cookie } }), msgs = [];
  ws.onmessage = e => { if (typeof e.data === 'string') msgs.push(JSON.parse(e.data)); };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  for (let k = 0; k < 100 && !msgs.some(x => x.t === 'you'); k++) await sleep(30);
  const send = o => ws.send(JSON.stringify(o));
  send({ t: 'pobserve', on: false });
  await sleep(1600);
  const st = await owner.post('/api/play/start', { module: 'fishing', course: 'harbour-morning', where: m.id });
  assert.equal(st.status, 200, JSON.stringify(st.json));
  const run = st.json.run, L = kitFor(STARTER, 'sea');
  // a fish: hook until something takes it, then land it no sooner than that gear could have
  let landed = null;
  for (let k = 0; k < 14 && !landed; k++) {
    const h = await owner.post('/api/play/act', { run, act: 'hook', body: { lure: 'shrimp', d0: 8 } });
    if (h.status === 200 && h.json.hook && h.json.what.kind === 'fish') {
      await sleep(minFightSeconds(speciesOf(h.json.what.species), h.json.what.kg, L, h.json.d0) * 1000 + 600);
      const ld = await owner.post('/api/play/act', { run, act: 'land', body: { hook: h.json.hook } });
      assert.equal(ld.status, 200, JSON.stringify(ld.json)); landed = ld.json.caught;
    } else await sleep(2600);
  }
  assert.ok(landed, 'a fish landed');
  const before = (await owner.get('/api/inventory')).json.stacks.filter(x => x.item === `fish:${landed.species}`).length;
  const fin = await owner.post('/api/play/finish', { run, report: {} });
  assert.equal(fin.status, 200); assert.ok(fin.json.ok && fin.json.catch?.stowed >= 1, `the catch into the inventory: ${JSON.stringify(fin.json.catch)}`);
  assert.ok(fin.json.dex?.fresh.includes(landed.species) && fin.json.dex.records.some(r => r.species === landed.species), `new to the Fishdex, a world record: ${JSON.stringify(fin.json.dex)}`);
  assert.ok(fin.json.badges.some(b => b.id === 'record_breaker'), 'the record breaker\'s badge with the trip\'s');
  const dex = (await owner.get('/api/fishing/dex')).json;
  assert.ok(dex.mine[landed.species]?.kg === landed.kg && dex.records[landed.species]?.mine && dex.of > 80, JSON.stringify(dex).slice(0, 300));
  const inv = (await owner.get('/api/inventory')).json, fish = inv.stacks.filter(x => x.item === `fish:${landed.species}`);
  assert.equal(fish.length, before + 1, `the fish is in the inventory: ${JSON.stringify({ c: fin.json.catch, landed, inv: inv.stacks.slice(0, 4), err: inv.error })}`);
  const piece = fish.find(x => x.attrs?.cm === landed.cm);
  assert.ok(piece && piece.attrs.kg === landed.kg && piece.attrs.vc > 0, `with its length, weight and price: ${JSON.stringify(piece?.attrs)}`);
  // out here (not at a store): refused
  send({ t: 'pwarp', x: m.x + 300, z: m.z + 300, ctx: -1 }); await sleep(400);
  const far = await owner.post('/api/fishing/sell', {});
  assert.equal(far.status, 409); assert.match(far.json.error, /dock store/);
  // at the store: paid from the fish market, the fish gone from the inventory
  const store = w.buildings.find(b => b && !b.gone && b.tackle && b.module === m.id);
  assert.ok(store, 'the marina has its store');
  send({ t: 'pwarp', x: store.x, z: store.z, ctx: -1 }); await sleep(500);
  const v1 = await owner.get('/api/fishing/market');
  assert.ok(v1.json.atStore && v1.json.items.some(x => x.stack === piece.id && x.price > 0), `at the store, the fish for sale: ${JSON.stringify(v1.json.items.slice(0, 3))}`);
  const sold = await owner.post('/api/fishing/sell', { stacks: [piece.id] });
  assert.equal(sold.status, 200, JSON.stringify(sold.json));
  assert.ok(sold.json.paid > 0 && sold.json.sold.some(x => x.stack === piece.id), `paid ${sold.json.paid}`);
  assert.ok(!(await owner.get('/api/inventory')).json.stacks.some(x => x.id === piece.id), 'sold: out of the inventory');
  const again = await owner.post('/api/fishing/sell', { stacks: [piece.id] });
  assert.equal(again.status, 404, 'sold once only');
  ws.close();
});

test('the gear shop: bait and tackle bought at a dock store into the inventory, the level each needs, what you fish with, the boat, skills; a trip takes what you hold and uses up its bait', async () => {
  const { DatabaseSync } = await import('node:sqlite'), path = await import('node:path');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let w = await world(), m = (w.worldModules || []).find(x => x.kind === 'marina');
  if (!m) { const [spot] = await spotsFor('marina'); assert.equal((await edit(owner, [{ op: 'wmod.add', module: spot }])).status, 200); w = await world(); m = w.worldModules.find(x => x.kind === 'marina'); }
  assert.equal((await owner.post('/api/economy/admin/switch', { name: 'enabled', on: true })).status, 200);
  const ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: owner.cookie } }), msgs = [];
  ws.onmessage = e => { if (typeof e.data === 'string') msgs.push(JSON.parse(e.data)); };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  for (let k = 0; k < 100 && !msgs.some(x => x.t === 'you'); k++) await sleep(30);
  const send = o => ws.send(JSON.stringify(o));
  send({ t: 'pobserve', on: false });
  send({ t: 'pwarp', x: m.x + 300, z: m.z + 300, ctx: -1 }); await sleep(400);
  let v = (await owner.get('/api/fishing/angler')).json;
  assert.ok(v.open && !v.atStore && v.level <= 2, JSON.stringify({ open: v.open, at: v.atStore, level: v.level }));
  assert.ok(v.rods[0].have && v.rods[0].using, 'the welcome kit\'s starter rod, in use');
  assert.equal((await owner.post('/api/fishing/buy', { kind: 'lure', id: 'shrimp' })).status, 409, 'not at a store: refused');
  const store = w.buildings.find(b => b && !b.gone && b.tackle && b.module === m.id), myId = (await owner.get('/api/auth/me')).json.account.id;
  send({ t: 'pwarp', x: store.x, z: store.z, ctx: -1 }); await sleep(500);
  assert.equal((await owner.post('/api/economy/admin/grant', { to: { kind: 'account', id: myId }, amount: 500000, memo: 'tackle money' })).status, 200);
  const shrimp = async () => (await owner.get('/api/inventory')).json.stacks.filter(x => x.item === 'lure:shrimp').reduce((a, x) => a + x.qty, 0);
  const s0 = await shrimp();
  const b1 = await owner.post('/api/fishing/buy', { kind: 'lure', id: 'shrimp', packs: 2 });
  assert.equal(b1.status, 200, JSON.stringify(b1.json));
  assert.equal(await shrimp(), s0 + 20, 'two packs of ten into the inventory');
  const locked = await owner.post('/api/fishing/buy', { kind: 'gear', id: 'rod_glass' });
  assert.equal(locked.status, 403); assert.match(locked.json.error, /level 3/);
  // fishing level 3 (written as the play core keeps it)
  const db = new DatabaseSync(path.join(s.data, 'next.db')); db.exec('PRAGMA busy_timeout = 5000');
  const wid = db.prepare("SELECT value FROM meta WHERE key = 'world_id'").get().value;
  db.prepare("INSERT INTO play_progress (world_id, account_id, module, xp, runs, updated) VALUES (?, ?, 'fishing', 240, 1, ?) ON CONFLICT (world_id, account_id, module) DO UPDATE SET xp = 240").run(wid, myId, Date.now());
  db.close();
  const wal0 = (await owner.get('/api/fishing/angler')).json.vc;
  const b2 = await owner.post('/api/fishing/buy', { kind: 'gear', id: 'rod_glass' });
  assert.equal(b2.status, 200, JSON.stringify(b2.json));
  assert.equal(b2.json.view.kit.rod, 'rod_glass', 'a new rod is used from now on');
  assert.ok((await owner.get('/api/inventory')).json.stacks.some(x => x.item === 'gear:rod_glass'), 'and it\'s in the inventory');
  const wal1 = b2.json.view.vc;
  assert.equal(wal0 - wal1, 15000, 'paid 150 VC');
  assert.equal((await owner.post('/api/fishing/buy', { kind: 'gear', id: 'rod_glass' })).status, 409, 'one is enough');
  const b3 = await owner.post('/api/fishing/buy', { kind: 'boat', id: 'cooler' });
  assert.equal(b3.status, 200, JSON.stringify(b3.json));
  assert.deepEqual([b3.json.view.boat.find(u => u.id === 'cooler').tier, b3.json.view.boat.find(u => u.id === 'cooler').value], [1, 20]);
  // skills: two points at level 3
  assert.equal(b3.json.view.points.total, 2);
  for (let k = 0; k < 2; k++) assert.equal((await owner.post('/api/fishing/skill', { id: 'casting' })).status, 200);
  assert.equal((await owner.post('/api/fishing/skill', { id: 'luck' })).status, 409, 'no points left');
  // what you fish with: back to the starter rod; not one you don't have
  assert.equal((await owner.post('/api/fishing/use', { rod: 'rod_graphite' })).status, 404);
  assert.equal((await owner.post('/api/fishing/use', { rod: 'rod_starter' })).json.kit.rod, 'rod_starter');
  // a trip takes it all
  await sleep(1600);
  const st = await owner.post('/api/play/start', { module: 'fishing', course: 'harbour-morning', where: m.id });
  assert.equal(st.status, 200, JSON.stringify(st.json));
  const K = st.json.data.kit;
  assert.ok(K.rod === 'rod_starter' && K.lures.shrimp === s0 + 20 && K.boat.cooler === 1 && K.skills.casting === 2, JSON.stringify(K));
  let bit = 0, left = null;
  for (let k = 0; k < 10 && bit < 2; k++) {
    const h = await owner.post('/api/play/act', { run: st.json.run, act: 'hook', body: { lure: 'shrimp', d0: 8 } });
    if (h.status === 200 && h.json.hook) { bit++; left = h.json.left; await owner.post('/api/play/act', { run: st.json.run, act: 'lose', body: { hook: h.json.hook, why: 'off' } }); }
    await sleep(2600);
  }
  assert.ok(bit >= 1, 'something took the shrimp');
  assert.equal(left, s0 + 20 - bit, 'each bite used one');
  const fin = await owner.post('/api/play/finish', { run: st.json.run, report: {} });
  assert.equal(fin.status, 200);
  assert.equal(await shrimp(), s0 + 20 - bit, `the bait a fish took left the inventory: ${JSON.stringify(fin.json.tackle)}`);
  // a fresh start for the skills, for a price
  const rs = await owner.post('/api/fishing/respec', {});
  assert.equal(rs.status, 200, JSON.stringify(rs.json));
  assert.ok(rs.json.skills.every(x => x.rank === 0) && rs.json.points.free === 2);
  ws.close();
});
