// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An AI agent as its owner's opponent, on a real server (server/play/versus.js, POST /api/versus/table, GET /api/versus):
// its owner at an arcade's table for two opens its game — the table held, their companion (no Free Will here: it joins
// in) walks to the other end and is there; the game's run is laid out with it (its name, its hand); a piece that isn't a
// table for two is a 400; guests no; let go, it is back at their side.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { WorldIndex } from '../server/sim/windex.js';
import { toWorld } from '../shared/geom.js';
import { PF_USING } from '../shared/playerproto.js';
import { versusOf, farSlot } from '../shared/versus.js';
import { startServer, ownerSession, httpClient } from './helpers/server.mjs';

let s, owner, guest, world, ws, ag, table, ctx;
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(200); } };
const info = async i => (await owner.get(`/api/agent/${i}`)).json;
let seq = 0;
const move = (x, z, flags = 0) => ws.send({ t: 'pmove', x, y: 0.15, z, yaw: 0, ctx, clip: 1, flags, seq: (seq = (seq + 1) & 65535) });

function conn(client) {
  const w = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: client.cookie } });
  const c = { w, msgs: [] };
  w.onmessage = e => { if (typeof e.data === 'string') c.msgs.push(JSON.parse(e.data)); };
  c.opened = new Promise((res, rej) => { w.onopen = res; w.onerror = () => rej(new Error('ws error')); });
  c.send = o => w.send(JSON.stringify(o));
  c.msg = (pred, ms) => waitFor(() => c.msgs.find(pred), ms);
  return c;
}

before(async () => {
  s = await startServer({ population: 220, agents: 2 });
  owner = await ownerSession(s);
  guest = httpClient(s.url);
  const W0 = (await owner.get('/api/world')).json.world;
  const B = W0.buildings.filter(b => b && !b.gone && (b.type === 'office' || b.type === 'hq') && b.floors >= 3).sort((a, b) => b.w * b.d - a.w * a.d)[0];
  assert.equal((await owner.post('/api/edit', { ops: [{ op: 'lvl.theme', b: B.idx, f: 1, theme: 'arcade' }] })).status, 200);
  world = (await owner.get('/api/world')).json.world;
  const idx = new WorldIndex(world), Bd = world.buildings[B.idx];
  for (const [id, e] of idx.slots(Bd.lv[1])) {
    const v = versusOf(e.it.t);
    if (!v?.game || table) continue;
    const you = farSlot(v, null, [farSlot(v)]), far = farSlot(v);
    table = { b: B.idx, f: 1, id, t: e.it.t, v, you: toWorld(Bd, e.slots[you].lx, e.slots[you].lz), youAp: toWorld(Bd, e.slots[you].ax, e.slots[you].az), far: toWorld(Bd, e.slots[far].lx, e.slots[far].lz) };
  }
  assert.ok(table, 'the arcade has a table for two');
  ctx = table.b * 64 + table.f;
  ag = (await owner.get('/api/agents')).json.agents;
  ws = conn(owner); await ws.opened;
  await ws.msg(m => m.t === 'you');
  ws.send({ t: 'pobserve', on: false });
  assert.equal((await owner.post('/api/clock', { rate: 20 })).status, 200);
});
after(async () => { try { ws?.w.close(); } catch { /* closed */ } await s?.stop(); });

test('its owner opens the game at a table for two: the companion walks to the other end and plays them; the run is laid out with it', async () => {
  const A = ag[0];
  ws.send({ t: 'pwarp', x: table.youAp.x, z: table.youAp.z, ctx });
  await wait(400);
  move(table.youAp.x, table.youAp.z);
  assert.equal((await owner.post('/api/companions', { agent: A.id, action: 'follow', target: 'me' })).status, 200);
  assert.ok(await waitFor(async () => { const x = await info(A.i); return x.pos?.ctx === ctx && Math.hypot(x.pos.x - table.youAp.x, x.pos.z - table.youAp.z) < 5; }, 90000), 'it came to its owner in the arcade');
  move(table.you.x, table.you.z, PF_USING);
  await wait(300);
  // the game opens: the table held (the page's own call), then the table for two
  assert.equal((await owner.post('/api/arcade/hold', { b: table.b, f: table.f, id: table.id, on: true })).json.held, true);
  const r = await owner.post('/api/versus/table', { b: table.b, f: table.f, id: table.id, on: true });
  assert.equal(r.status, 200, r.text);
  const coming = r.json.vs || (await waitFor(async () => (await owner.get('/api/versus')).json.vs, 15000));
  assert.ok(coming, `a companion is coming: ${JSON.stringify(r.json)}`);
  assert.equal(coming.agent, A.id);
  const ready = await waitFor(async () => { const v = (await owner.get('/api/versus')).json; return v.vs?.state === 'ready' ? v.vs : null; }, 60000);
  assert.ok(ready, 'it got to the other end');
  const at = await info(A.i);
  assert.ok(Math.hypot(at.pos.x - table.far.x, at.pos.z - table.far.z) < 0.8, `its body at the far end (${JSON.stringify(at.pos)} vs ${JSON.stringify(table.far)})`);
  assert.ok(ws.msgs.some(m => m.t === 'versus' && /other end/.test(m.text || '')), 'its owner\'s page heard it');
  // the run: laid out with it — its name, its hand
  const st = await owner.post('/api/play/start', { module: 'arcade', course: table.v.game.id, where: { b: table.b, f: table.f, id: table.id } });
  assert.equal(st.status, 200, st.text);
  assert.equal(st.json.data.vs?.agent, A.id);
  assert.equal(st.json.data.vs.name, ready.name);
  assert.ok(st.json.data.vs.k >= 50, 'never weaker than the computer');
  await owner.post('/api/play/abandon', { run: st.json.run });
  // let go: back at its owner's side
  assert.equal((await owner.post('/api/versus/table', { b: table.b, f: table.f, id: table.id, on: false })).status, 200);
  move(table.youAp.x, table.youAp.z);
  await owner.post('/api/arcade/hold', { b: table.b, f: table.f, id: table.id, on: false });
  assert.ok(await waitFor(async () => !(await owner.get('/api/versus')).json.vs, 40000), 'the match is over');
});

test('only a table for two; guests no', async () => {
  const items = world.levels[world.buildings[table.b].lv[1]].items, other = items.find(i => !versusOf(i.t));
  const r = await owner.post('/api/versus/table', { b: table.b, f: 1, id: other.id, on: true });
  assert.equal(r.status, 400, r.text);
  assert.ok([401, 403].includes((await guest.post('/api/versus/table', { b: table.b, f: 1, id: table.id, on: true })).status));
  assert.ok([401, 403].includes((await guest.get('/api/versus')).status));
});
