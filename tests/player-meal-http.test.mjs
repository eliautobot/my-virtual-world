// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A player orders at a restaurant's table on a real server (2026-11-18, the product owner: "once I sit down, there's a button to order,
// a menu … the transaction … the plate should appear in front of the player character"): sitting at a table there, what
// they buy is served in front of them — every page drawing them is told (t: 'pmeal') —, gone when they get up; bought
// standing at the counter, served when they sit down there; a player elsewhere is told to go there.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { WorldIndex } from '../server/sim/windex.js';
import { PlayerNav } from '../shared/playernav.js';
import { toWorld } from '../shared/geom.js';
import { ctxOf } from '../shared/constants.js';
import { PF_USING } from '../shared/playerproto.js';
import { FOOD_BY_ID } from '../shared/food.js';
import { startServer, ownerSession } from './helpers/server.mjs';

let s, owner, world, ws, me;
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(120); } };
let seq = 0;
function conn(client) {
  const w = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: client.cookie } });
  const c = { w, msgs: [] };
  w.onmessage = e => { if (typeof e.data === 'string') c.msgs.push(JSON.parse(e.data)); };
  c.opened = new Promise((res, rej) => { w.onopen = res; w.onerror = () => rej(new Error('ws error')); });
  c.send = o => w.send(JSON.stringify(o));
  c.msg = (pred, ms) => waitFor(() => c.msgs.find(pred), ms);
  return c;
}
const move = (x, z, ctx, flags = 0) => ws.send({ t: 'pmove', x, y: 0.15, z, yaw: 0, ctx, clip: 1, flags, seq: (seq = (seq + 1) & 65535) });

/** A restaurant's table on its ground floor: a seat (world x, z) and where one stands to sit on it. */
function restaurantSeat() {
  const idx = new WorldIndex(world), nav = new PlayerNav(world);
  for (const v of idx.venues.restaurant || []) {
    if (v.f !== 0) continue;
    const B = world.buildings[v.b], ctx = ctxOf(v.b, 0);
    for (const [, e] of idx.slots(B.lv[0])) for (const sl of e.slots) {
      if (sl.use !== 'eat' || sl.y) continue;   // (a table's chair, not a bar stool)
      const at = toWorld(B, sl.lx, sl.lz), ap = toWorld(B, sl.ax, sl.az);
      if (nav.ok(ap.x, ap.z, ctx)) return { b: v.b, f: 0, ctx, at, ap };
    }
  }
  return null;
}

before(async () => {
  s = await startServer({ population: 260, agents: 0 });
  owner = await ownerSession(s);
  assert.equal((await owner.post('/api/economy/admin/switch', { name: 'enabled', on: true })).status, 200);
  world = (await owner.get('/api/world')).json.world;
  ws = conn(owner); await ws.opened;
  me = await ws.msg(m => m.t === 'you');
  ws.send({ t: 'pobserve', on: false });
  assert.equal((await owner.post('/api/economy/admin/grant', { to: { kind: 'account', id: me.pid }, amount: 500000, memo: 'dinner money' })).status, 200);
});
after(async () => { try { ws?.w.close(); } catch { /* closed */ } await s?.stop(); });

test('sitting at a restaurant table: the order is served in front of the player; up from the table, it is gone', async () => {
  const st = restaurantSeat();
  assert.ok(st, 'a restaurant table');
  const place = (await owner.get(`/api/economy/place?b=${st.b}&f=${st.f}`)).json.business;
  assert.ok(place?.menu?.length, 'its menu');
  const dish = place.menu.find(m => FOOD_BY_ID[m.id] && !FOOD_BY_ID[m.id].v), drink = place.menu.find(m => FOOD_BY_ID[m.id]?.v);
  assert.ok(dish, 'a dish on the menu');
  const items = [{ id: dish.id, n: 1 }, ...(drink ? [{ id: drink.id, n: 1 }] : [])];
  // elsewhere: told to go there
  let r = await owner.post('/api/economy/buy', { business: place.id, items });
  assert.equal(r.status, 409, r.text);
  // in, and down at the table (its page: PF_USING where the seat is)
  ws.send({ t: 'pwarp', x: st.ap.x, z: st.ap.z, ctx: st.ctx });
  await wait(500);
  move(st.ap.x, st.ap.z, st.ctx);
  await wait(300);
  move(st.at.x, st.at.z, st.ctx, PF_USING);
  await wait(500);
  ws.msgs.length = 0;
  r = await owner.post('/api/economy/buy', { business: place.id, items, idem: 'meal-1' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.served, 'served');
  const m = await ws.msg(x => x.t === 'pmeal' && x.pid === me.pid && x.items.length);
  assert.ok(m, 'every page drawing the player is told');
  assert.deepEqual(m.items, items.map(l => FOOD_BY_ID[l.id].n));
  assert.ok(m.dur >= 4 * 60000 && m.el < 5000);
  // up from the table: the meal is over
  ws.msgs.length = 0;
  move(st.ap.x, st.ap.z, st.ctx, 0);
  const gone = await ws.msg(x => x.t === 'pmeal' && x.pid === me.pid && !x.items.length);
  assert.ok(gone, 'the plate is gone when they get up');
});

test('bought standing at the counter: served when they sit down there', async () => {
  const st = restaurantSeat(), place = (await owner.get(`/api/economy/place?b=${st.b}&f=${st.f}`)).json.business;
  const dish = place.menu.find(m => FOOD_BY_ID[m.id] && !FOOD_BY_ID[m.id].v);
  move(st.ap.x, st.ap.z, st.ctx, 0);
  await wait(300);
  const r = await owner.post('/api/economy/buy', { business: place.id, items: [{ id: dish.id, n: 1 }], idem: 'meal-2' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.served, 'waiting');
  ws.msgs.length = 0;
  move(st.at.x, st.at.z, st.ctx, PF_USING);
  const m = await ws.msg(x => x.t === 'pmeal' && x.pid === me.pid && x.items.length);
  assert.deepEqual(m?.items, [FOOD_BY_ID[dish.id].n], 'served when they sat down');
});
