// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agents cooking Order Up and working shifts by their own choice, on a real server (server/play/kitchen-play.js,
// work-play.js through the interaction registry's owner routes): its owner walks into a café with it and starts a Rush on
// their page — their companion (no Free Will of its own) goes into the kitchen and cooks one alongside, the same orders on
// their clock; the owner's GET /api/interactions says what it can do now (stopping, while it cooks), POST stops it
// (nothing recorded); a shift as the café's barista is among what it can do, and it works one for real.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PlayerNav } from '../shared/playernav.js';
import { WorldIndex } from '../server/sim/windex.js';
import { toWorld } from '../shared/geom.js';
import { ctxOf } from '../shared/constants.js';
import { startServer, ownerSession } from './helpers/server.mjs';

let s, owner, world, nav, ws, ag;
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(150); } };
const info = async i => (await owner.get(`/api/agent/${i}`)).json;
let seq = 0;
const move = (x, z, ctx) => ws.send({ t: 'pmove', x, y: 0.15, z, yaw: 0, ctx, clip: 1, flags: 0, seq: (seq = (seq + 1) & 65535) });

function conn(client) {
  const w = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: client.cookie } });
  const c = { w, msgs: [] };
  w.onmessage = e => { if (typeof e.data === 'string') c.msgs.push(JSON.parse(e.data)); };
  c.opened = new Promise((res, rej) => { w.onopen = res; w.onerror = () => rej(new Error('ws error')); });
  c.send = o => w.send(JSON.stringify(o));
  c.msg = (pred, ms) => waitFor(() => c.msgs.find(pred), ms);
  return c;
}
/** A ground-floor café kitchen: { b, f, ctx, spot (a walkable spot in the café's room) }. */
function cafeKitchen() {
  const idx = new WorldIndex(world);
  for (const v of idx.venues.cafe) {
    const B = world.buildings[v.b], L = world.levels[B.lv[v.f]];
    if (v.f !== 0 || !(L.mods || []).some(m => m.kind === 'kitchen')) continue;
    const ctx = ctxOf(v.b, v.f);
    for (const [, e] of idx.slots(B.lv[v.f])) for (const sl of e.slots) {
      if (sl.use !== 'eat' && sl.use !== 'relax') continue;
      const p = toWorld(B, sl.ax, sl.az);
      if (nav.ok(p.x, p.z, ctx)) return { b: v.b, f: v.f, ctx, spot: p };
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
  assert.equal((await owner.post('/api/clock', { rate: 4 })).status, 200);
});
after(async () => { try { ws?.w.close(); } catch { /* closed */ } await s?.stop(); });

test('its owner cooks a Rush in a café: their companion goes into the kitchen and cooks one alongside (the same orders, their clock); the owner\'s routes list stopping it and stop it — nothing recorded', async () => {
  const A = ag[0], K = cafeKitchen();
  assert.ok(K, 'a café with a kitchen');
  ws.send({ t: 'pwarp', x: K.spot.x, z: K.spot.z, ctx: K.ctx });
  await wait(400);
  move(K.spot.x, K.spot.z, K.ctx);
  assert.equal((await owner.post('/api/companions', { agent: A.id, action: 'follow', target: 'me' })).status, 200);
  assert.ok(await waitFor(async () => { const x = await info(A.i); return x.pos?.ctx === K.ctx; }, 90000), 'it came into the café with them');
  const st = await owner.post('/api/play/start', { module: 'orderup', course: 'warmup', where: { b: K.b, f: K.f } });
  assert.equal(st.status, 200, st.text);
  // (no Free Will of its own: it joins in by itself a moment after their Rush begins)
  const cooking = await waitFor(async () => { const x = await info(A.i); return /^Cooking a Warm-up alongside /.test(x.act?.label || '') ? x : null; }, 30000);
  assert.ok(cooking, 'cooking alongside them');
  const run = (await owner.get(`/api/play/profile?id=${-A.id}`)).json;
  assert.ok(run, 'its own profile');
  const g = await owner.get(`/api/interactions?agent=${A.id}`);
  assert.equal(g.status, 200, g.text);
  assert.equal(g.json.things[0]?.id, 'orderup:stop', g.json.things.map(x => x.label).join(' | '));
  assert.match(g.json.things[0].label, /^Stop cooking \(Warm-up in «.+»'s kitchen, \d:\d\d to go/);
  const r = await owner.post('/api/interactions', { agent: A.id, id: 'orderup:stop' });
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.brain, /a Rush given up doesn't count, nothing is recorded/);
  assert.equal(((await owner.get(`/api/play/profile?id=${-A.id}`)).json?.modules?.orderup?.runs) || 0, 0, 'nothing recorded');
  assert.ok(await waitFor(async () => { const x = await info(A.i); return !/^Cooking/.test(x.act?.label || ''); }, 20000), 'out of the kitchen, with them again');
  await owner.post('/api/play/abandon', { run: st.json.run });
});

test('a barista\'s shift at the café is among what it can do there, and it works one for real (the jobs core\'s shift)', async () => {
  const A = ag[0];
  assert.ok(!((await owner.get(`/api/interactions?agent=${A.id}`)).json.things || []).some(x => x.source === 'work'), 'the economy off: no shifts');
  assert.equal((await owner.post('/api/economy/admin/switch', { name: 'enabled', on: true })).status, 200);
  const g = await owner.get(`/api/interactions?agent=${A.id}`);
  const shift = (g.json.things || []).find(x => x.source === 'work' && /as Barista at «/.test(x.label));
  assert.ok(shift, (g.json.things || []).map(x => x.label).join(' | '));
  const r = await owner.post('/api/interactions', { agent: A.id, id: shift.id });
  assert.equal(r.status, 200, r.text);
  assert.ok(await waitFor(async () => { const x = await info(A.i); return x.act?.label === 'Working as Barista'; }, 30000), 'behind the counter');
  const ended = await waitFor(async () => { const h = (await owner.get(`/api/interactions?agent=${A.id}`)).json.things || []; const stop = h.find(x => x.id === 'work:stop'); return stop && /: [1-9]\d* drinks?/.test(stop.label) ? stop : null; }, 60000);
  assert.ok(ended, 'orders worked');
  const e = await owner.post('/api/interactions', { agent: A.id, id: 'work:stop' });
  assert.equal(e.status, 200, e.text);
  assert.match(e.json.brain, /^you ended your shift: \d+ drinks?, paid .+ into your wallet/);
});
