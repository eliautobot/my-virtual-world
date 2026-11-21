// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Companions sitting down with their player on a real server (server/companions/, server/sim/companion-moves.js): the
// owner's player sits on a park bench (its page's PF_USING), POST /api/companions { agent, action: 'sit' } — the agent
// sits down on the bench's other end and the Companions list says so; 'eat' there is an honest 409 (no table, no food)
// with what its brain is told; 'stand' gets it up again.
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
const list = async () => (await owner.get('/api/companions')).json;
const cmd = body => owner.post('/api/companions', body);
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
/** A park bench a player can walk up to: its two seats (world x, z) and where one stands to sit on the first. */
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
  assert.equal((await owner.post('/api/clock', { rate: 20 })).status, 200);   // (bodies walk 20× faster)
});
after(async () => { try { ws?.w.close(); } catch { /* closed */ } await s?.stop(); });

test('the player on a park bench: "sit" — the agent sits on its other end; "eat" there is an honest 409; "stand"', async () => {
  const A = ag[0], bn = parkBench();
  assert.ok(bn, 'a park bench');
  // the player walks up to the bench (an admin's warp, then a step), and its agent comes along
  ws.send({ t: 'pwarp', x: bn.ap.x, z: bn.ap.z, ctx: -1 });
  await wait(400);
  move(bn.ap.x, bn.ap.z);
  assert.equal((await cmd({ agent: A.id, action: 'follow', target: 'me' })).status, 200);
  const near = await waitFor(async () => { const x = await info(A.i); return Math.hypot(x.pos.x - bn.ap.x, x.pos.z - bn.ap.z) < 4 ? x : null; }, 60000);
  assert.ok(near, 'it came to the player');
  // the player sits down on the bench (as its page says: PF_USING, where the seat is)
  await wait(300);
  move(bn.a.x, bn.a.z, PF_USING);
  await wait(400);
  const r = await cmd({ agent: A.id, action: 'sit' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.action, 'sit');
  assert.match(r.json.text, /sit down on a bench beside you$|sits down on a bench beside you$/);
  assert.match(r.json.brain, /^you (sat down|are walking over to sit down) on a bench beside /);
  const sat = await waitFor(async () => { const x = await info(A.i); return x.act?.use === 'bench' && Math.hypot(x.pos.x - bn.b2.x, x.pos.z - bn.b2.z) < 0.5 && !x.moving ? x : null; }, 30000);
  assert.ok(sat, 'it sat down on the bench\'s other end');
  const c = await waitFor(async () => (await list()).companions.find(x => x.agent === A.id && x.seat), 10000);
  assert.ok(c, 'the Companions list has its seat');
  assert.equal(c.seat.words, 'a bench');
  assert.equal(c.doing, 'Sitting with you on a bench');
  assert.equal(c.state, 'following');
  // 'eat' on a park bench: no table, no food — a 409 with its words, nothing claimed
  const e = await cmd({ agent: A.id, action: 'eat' });
  assert.equal(e.status, 409, e.text);
  assert.deepEqual([e.json.ok, e.json.code], [false, 'not_food']);
  assert.match(e.json.brain, /^you could not join .+'s meal: .+ is not at a place that serves food$/);
  assert.match(e.json.error, /can't join your meal/);
  // 'stand': up, and beside the player again
  const st = await cmd({ agent: A.id, action: 'stand' });
  assert.equal(st.status, 200, st.text);
  assert.match(st.json.brain, /^you got up from a bench/);
  const up = await waitFor(async () => { const x = await info(A.i); return x.act?.use !== 'bench' && x.act?.kind === 'follow' ? x : null; }, 10000);
  assert.ok(up, 'it got up');
  assert.equal((await list()).companions.find(x => x.agent === A.id)?.seat, null);
  await cmd({ agent: A.id, action: 'dismiss' });
});
