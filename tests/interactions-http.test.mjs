// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What an agent can do in the world, on a real server (server/interactions/routes.js): its owner sees what it can do
// right where its body is (GET /api/interactions?agent=) — out with them on a park bench: sitting down with them first —
// and tells it to (POST /api/interactions { agent, id }): it sits down beside them for real; something no longer there
// is an honest 409 with its words; someone else's agent is not there (404).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PlayerNav } from '../shared/playernav.js';
import { WorldIndex } from '../server/sim/windex.js';
import { toWorld } from '../shared/geom.js';
import { PF_USING } from '../shared/playerproto.js';
import { startServer, ownerSession } from './helpers/server.mjs';

let s, owner, world, nav, ws, ag;
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(150); } };
const info = async i => (await owner.get(`/api/agent/${i}`)).json;
let seq = 0;
const move = (x, z, flags = 0) => ws.send({ t: 'pmove', x, y: 0.15, z, yaw: 0, ctx: -1, clip: 1, flags, seq: (seq = (seq + 1) & 65535) });

function conn(client) {
  const w = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: client.cookie } });
  const c = { w, msgs: [] };
  w.onmessage = e => { if (typeof e.data === 'string') c.msgs.push(JSON.parse(e.data)); };
  c.opened = new Promise((res, rej) => { w.onopen = res; w.onerror = () => rej(new Error('ws error')); });
  c.send = o => w.send(JSON.stringify(o));
  c.msg = (pred, ms) => waitFor(() => c.msgs.find(pred), ms);
  return c;
}
function parkBench() {
  const idx = new WorldIndex(world);
  for (const v of idx.venues.park) {
    const B = world.buildings[v.b];
    for (const [id, e] of idx.slots(B.lv[0])) {
      if (e.it.t !== 'bench' || e.slots.length !== 2) continue;
      const [a, b] = e.slots.map(sl => toWorld(B, sl.lx, sl.lz)), ap = toWorld(B, e.slots[0].ax, e.slots[0].az);
      if (nav.ok(ap.x, ap.z, -1)) return { b: v.b, id, a, b2: b, ap };
    }
  }
  return null;
}

before(async () => {
  s = await startServer({ population: 220, agents: 2 });
  owner = await ownerSession(s);
  world = (await owner.get('/api/world')).json.world;
  nav = new PlayerNav(world);
  ag = (await owner.get('/api/agents')).json.agents;
  ws = conn(owner); await ws.opened;
  await ws.msg(m => m.t === 'you');
  ws.send({ t: 'pobserve', on: false });
  assert.equal((await owner.post('/api/clock', { rate: 20 })).status, 200);
});
after(async () => { try { ws?.w.close(); } catch { /* closed */ } await s?.stop(); });

test('its owner on a park bench: sitting down with them is what it can do first; told to, it really does; a stale id is an honest 409', async () => {
  const A = ag[0], bn = parkBench();
  assert.ok(bn, 'a park bench');
  ws.send({ t: 'pwarp', x: bn.ap.x, z: bn.ap.z, ctx: -1 });
  await wait(400);
  move(bn.ap.x, bn.ap.z);
  assert.equal((await owner.post('/api/companions', { agent: A.id, action: 'follow', target: 'me' })).status, 200);
  assert.ok(await waitFor(async () => { const x = await info(A.i); return Math.hypot(x.pos.x - bn.ap.x, x.pos.z - bn.ap.z) < 4; }, 60000), 'it came to the player');
  await wait(300);
  move(bn.a.x, bn.a.z, PF_USING);
  await wait(500);
  const g = await owner.get(`/api/interactions?agent=${A.id}`);
  assert.equal(g.status, 200, g.text);
  const things = g.json.things;
  assert.ok(Array.isArray(things) && things.length > 0, JSON.stringify(g.json));
  assert.equal(things[0].id, 'body:sit', `sitting with them first: ${things.map(x => x.label).join(' | ')}`);
  assert.match(things[0].label, /^Sit down with .+ \(they are sitting on a bench\)$/);
  assert.ok(things.filter(x => x.source === 'places').every(x => / — then back to /.test(x.label)), 'out with them: only a quick errand and back');
  const r = await owner.post('/api/interactions', { agent: A.id, id: 'body:sit' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ok, true);
  assert.match(r.json.brain, /on a bench beside /);
  assert.ok(await waitFor(async () => { const x = await info(A.i); return x.act?.use === 'bench' && Math.hypot(x.pos.x - bn.b2.x, x.pos.z - bn.b2.z) < 0.5; }, 30000), 'it sat down on the bench\'s other end');
  // sitting already: no "sit" any more — an honest 409
  const again = await owner.post('/api/interactions', { agent: A.id, id: 'body:sit' });
  assert.equal(again.status, 409);
  assert.equal(again.json.ok, false);
  assert.match(again.json.brain, /no longer there/);
  // not an agent of theirs, or none at all: not there
  assert.equal((await owner.get('/api/interactions?agent=999999')).status, 404);
  assert.equal((await owner.post('/api/interactions', { agent: 999999, id: 'body:sit' })).status, 404);
});
