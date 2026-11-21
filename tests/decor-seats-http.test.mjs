// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A bench placed on open land, on a real server (server/sim/decor-seats.js, server/interactions/sources/decor.js): an
// administrator puts one up just beyond the city's streets (POST /api/edit deco.add); its owner walks up with an agent
// and sits on one end — what the agent can do first is to sit down with them there ("they are sitting on a bench by
// «…»"); told to, it really sits on the other end; they walk off, it gets up and comes along; let go there, on its own it
// is offered the bench and sits on it for real. On an island with a marina (a world module: its benches are the world's
// own decorations, shared/dock-layout.js dockDecor): its owner sits on a bench on the marina's promenade, the agent sits
// down on its other end — "a bench at «… Marina»" — at the dock's height.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { PlayerNav } from '../shared/playernav.js';
import { Island } from '../shared/terrain.js';
import { RoadNetwork } from '../shared/roads.js';
import { checkWorldModule } from '../shared/world-modules.js';
import { fitToShore } from '../shared/dock-layout.js';
import { coastline, protectedWhy } from '../shared/coasts.js';
import { buildingPads } from '../shared/island-build.js';
import { CATALOG } from '../shared/catalog.js';
import { makeGrid } from '../shared/city.js';
import { PF_USING } from '../shared/playerproto.js';
import { startServer, ownerSession, tempDir, ROOT } from './helpers/server.mjs';

let s, owner, ws, ag;
const servers = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(150); } };
const info = async i => (await owner.get(`/api/agent/${i}`)).json;
let seq = 0;
const move = (x, z, flags = 0) => ws.send({ t: 'pmove', x, y: 0.15, z, yaw: 0, ctx: -1, clip: 1, flags, seq: (seq = (seq + 1) & 65535) });

function conn(client, srv = s) {
  const w = new WebSocket(srv.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: client.cookie } });
  const c = { w, msgs: [] };
  w.onmessage = e => { if (typeof e.data === 'string') c.msgs.push(JSON.parse(e.data)); };
  c.opened = new Promise((res, rej) => { w.onopen = res; w.onerror = () => rej(new Error('ws error')); });
  c.send = o => w.send(JSON.stringify(o));
  c.msg = (pred, ms) => waitFor(() => c.msgs.find(pred), ms);
  return c;
}
/** A slot's world place (the decoration is its own frame: client/js/player/player.js findTarget). */
const slotAt = (d, sl) => { const c = Math.cos(d.r), s = Math.sin(d.r); return { x: d.x + sl.x * c + sl.z * s, z: d.z - sl.x * s + sl.z * c }; };

before(async () => {
  s = await startServer({ population: 220, agents: 2 });
  owner = await ownerSession(s);
  ag = (await owner.get('/api/agents')).json.agents;
  ws = conn(owner); await ws.opened;
  await ws.msg(m => m.t === 'you');
  ws.send({ t: 'pobserve', on: false });
  assert.equal((await owner.post('/api/clock', { rate: 20 })).status, 200);
});
after(async () => { try { ws?.w.close(); } catch { /* closed */ } await s?.stop(); for (const x of servers) await x.stop().catch(() => {}); });

test('a bench on open land: its owner sits on one end, the agent sits down on the other when told; they walk off, it comes along; on its own it sits there too', async () => {
  // a bench just beyond the city's streets, on open ground a player walks (the server's own rules place it)
  let world = (await owner.get('/api/world')).json.world;
  const g = makeGrid(world.grid), nav = new PlayerNav(world), R = CATALOG.bench.rect;
  let bench = null;
  for (let k = 0; k < 40 && !bench; k++) {
    const z = g.minZ + 20 + k * ((g.maxZ - g.minZ - 40) / 40), x = g.maxX + 14, d = { t: 'bench', x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, r: 0 };
    const pts = [[0, 0], [R[0], R[1]], [R[2], R[3]], [-0.5, 0.85], [0.5, 0.85], [0, 3], [6, 3]];
    if (!pts.every(([dx, dz]) => nav.ok(d.x + dx, d.z + dz, -1) && !nav.wet(d.x + dx, d.z + dz))) continue;
    const r = await owner.post('/api/edit', { ops: [{ op: 'deco.add', deco: d }] });
    if (r.status === 200) bench = { ...d, id: r.json.results[0].id };
  }
  assert.ok(bench, 'a bench placed on open land');
  world = (await owner.get('/api/world')).json.world;
  assert.ok(world.decorations.some(d => d.id === bench.id), 'in the world');
  const [s0, s1] = CATALOG.bench.slots.map(sl => slotAt(bench, sl)), ap = slotAt(bench, { x: -0.5, z: 0.85 + 1 });
  const A = ag[0];
  ws.send({ t: 'pwarp', x: ap.x, z: ap.z, ctx: -1 });
  await wait(400);
  move(ap.x, ap.z);
  assert.equal((await owner.post('/api/companions', { agent: A.id, action: 'follow', target: 'me' })).status, 200);
  assert.ok(await waitFor(async () => { const x = await info(A.i); return Math.hypot(x.pos.x - ap.x, x.pos.z - ap.z) < 4; }, 60000), 'it came to the player');
  await wait(300);
  move(s0.x, s0.z, PF_USING);
  await wait(500);
  const g1 = await owner.get(`/api/interactions?agent=${A.id}`);
  assert.equal(g1.status, 200, g1.text);
  const things = g1.json.things;
  assert.equal(things[0]?.id, 'body:sit', `sitting with them first: ${things.map(x => x.label).join(' | ')}`);
  assert.match(things[0].label, /^Sit down with .+ \(they are sitting on a bench by «.+»\)$/);
  const r = await owner.post('/api/interactions', { agent: A.id, id: 'body:sit' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ok, true);
  assert.match(r.json.brain, /on a bench by «.+» beside /);
  assert.ok(await waitFor(async () => { const x = await info(A.i); return x.act?.use === 'bench' && Math.hypot(x.pos.x - s1.x, x.pos.z - s1.z) < 0.5; }, 30000), 'it sat down on the bench\'s other end');
  // they get up and walk off: up and with them
  // (up and off at a walk: the server takes a player's steps as they come — a seat, then a few steps away)
  const off = { x: ap.x - 6, z: ap.z + 4 };
  for (let k = 0; k <= 6; k++) { move(ap.x + (off.x - ap.x) * k / 6, ap.z + (off.z - ap.z) * k / 6); await wait(250); }
  let last = null;
  assert.ok(await waitFor(async () => { const x = last = await info(A.i); return x.act?.use !== 'bench' && Math.hypot(x.pos.x - off.x, x.pos.z - off.z) < 4; }, 30000), `it got up and came along: ${JSON.stringify({ act: last?.act, pos: last?.pos, off, corrections: ws.msgs.filter(m => m.t === 'pcorr').slice(-3) })}`);
  // let go right there: on its own, the bench is offered and it sits on it
  assert.equal((await owner.post('/api/companions', { agent: A.id, action: 'dismiss' })).status, 200);
  const mine = await waitFor(async () => { const x = await owner.get(`/api/interactions?agent=${A.id}`); return (x.json.things || []).find(t => t.id === `decor:${bench.id}.bench`); }, 10000);
  assert.ok(mine, 'on its own: the bench near it');
  assert.match(mine.label, /^Sit down on a bench by «.+»$/);
  const r2 = await owner.post('/api/interactions', { agent: A.id, id: mine.id });
  assert.equal(r2.status, 200, r2.text);
  assert.ok(await waitFor(async () => { const x = await info(A.i); return x.act?.use === 'bench' && [s0, s1].some(q => Math.hypot(x.pos.x - q.x, x.pos.z - q.z) < 0.5); }, 30000), 'it sat on the bench');
});

test('a marina\'s bench (its own decoration on its promenade): its owner sits on one end, the agent sits down on the other — named after the marina, at the dock\'s height', async () => {
  const dir = tempDir('mvw-decor-dock-');
  await (await startServer({ data: dir, population: 120, agents: 1 })).stop({ keepData: true });
  for (const tool of ['add-island', 'add-roads']) { const r = spawnSync(process.execPath, [`tools/wp4/${tool}.mjs`, '--data', dir, '--server-stopped'], { cwd: ROOT, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); }
  const S2 = await startServer({ data: dir, population: 120 });
  servers.push(S2);
  const O = await ownerSession(S2), W2 = conn(O, S2);
  await W2.opened; await W2.msg(m => m.t === 'you');
  W2.send({ t: 'pobserve', on: false });
  let q = 0;
  const go = (x, y, z, flags = 0) => W2.send({ t: 'pmove', x, y, z, yaw: 0, ctx: -1, clip: 1, flags, seq: (q = (q + 1) & 65535) });
  // a marina at a shore the placing tool fits it to (tests/docks-http.test.mjs)
  let w = (await O.get('/api/world')).json.world;
  const T = w.terrain, isl = new Island(T, { roads: w.roads }).withPads(buildingPads(w)), net = RoadNetwork.fromJSON(w.roads);
  const env = { heightAt: (x, z) => isl.height(x, z), isWater: (x, z) => !!isl.waterAt(x, z), waterAt: (x, z) => isl.waterAt(x, z), coastWhy: (x, z) => protectedWhy(isl, x, z, 0), roads: net };
  let spot = null;
  for (const c of coastline(isl)) {
    const dx = c.x - T.center.x, dz = c.z - T.center.z, d = Math.hypot(dx, dz);
    for (const back of [20, 40]) { const fit = fitToShore('marina', c.x - dx / d * back, c.z - dz / d * back, env); if (fit && !checkWorldModule(w, { kind: 'marina', ...fit }, env)) { spot = { kind: 'marina', ...fit }; break; } }
    if (spot) break;
  }
  assert.ok(spot, 'a shore for a marina');
  assert.equal((await O.post('/api/edit', { ops: [{ op: 'wmod.add', module: spot }] })).status, 200);
  w = (await O.get('/api/world')).json.world;
  const m = w.worldModules.find(x => x.kind === 'marina'), ground = new Island(w.terrain, { roads: w.roads }).withPads(buildingPads(w));
  const benches = w.decorations.filter(d => d.mod === m.id && d.t === 'bench');
  assert.ok(benches.length >= 2, 'the marina\'s benches');
  const bench = benches[0], [s0, s1] = CATALOG.bench.slots.map(sl => slotAt(bench, sl)), ap = slotAt(bench, { x: -0.5, z: 0.85 + 1 });
  const land = ground.height(bench.x, bench.z);
  const A = (await O.get('/api/agents')).json.agents[0];
  W2.send({ t: 'pwarp', x: ap.x, z: ap.z, ctx: -1 });
  await wait(400);
  go(ap.x, land, ap.z);
  assert.equal((await O.post('/api/clock', { rate: 40 })).status, 200);   // (its walk out to the marina, quickly)
  assert.equal((await O.post('/api/companions', { agent: A.id, action: 'follow', target: 'me' })).status, 200);
  const at = async () => (await O.get(`/api/agent/${A.i}`)).json;
  assert.ok(await waitFor(async () => { const x = await at(); return Math.hypot(x.pos.x - ap.x, x.pos.z - ap.z) < 4; }, 180000), 'it came down to the marina with its owner');
  await O.post('/api/clock', { rate: 1 });
  go(s0.x, land, s0.z, PF_USING);
  await wait(600);
  const things = (await O.get(`/api/interactions?agent=${A.id}`)).json.things || [];
  assert.equal(things[0]?.id, 'body:sit', `sitting with them first: ${things.map(x => x.label).join(' | ')}`);
  assert.match(things[0].label, new RegExp(`^Sit down with .+ \\(they are sitting on a bench at «${m.name}»\\)$`));
  const r = await O.post('/api/interactions', { agent: A.id, id: 'body:sit' });
  assert.equal(r.status, 200, r.text);
  // (its walk round to the other end at the clock's own rate: under a full test run's load a little slower — waited for)
  const sat = await waitFor(async () => { const x = await at(); return x.act?.use === 'bench' && Math.hypot(x.pos.x - s1.x, x.pos.z - s1.z) < 0.5 ? x : null; }, 90000);
  assert.ok(sat, 'it sat down on the bench\'s other end');
  assert.ok(Math.abs(sat.pos.y - (land + CATALOG.bench.slots[1].y)) < 0.05, `at the dock's height: ${sat.pos.y} (the land ${land.toFixed(2)})`);
  assert.equal(sat.act.place, m.name);
  try { W2.w.close(); } catch { /* closed */ }
});
