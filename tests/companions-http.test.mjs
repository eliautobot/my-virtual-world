// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Companions on a real server (server/companions/, docs/features/companions.md): an owner's player takes an agent along
// ("follow me") and it walks over to them and stays with them as they move; in sim mode (the player's body parked) it
// waits beside the body; at most companions.maxPerPlayer follow one player; it waits at a spot, meets up with others, goes
// with another of its owner's agents; dismissed, it goes back to its day; nobody else may command it.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PlayerNav } from '../shared/playernav.js';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann, nav, world, ws, me, ag;
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(150); } };
const info = async i => (await owner.get(`/api/agent/${i}`)).json;
const list = async (c = owner) => (await c.get('/api/companions')).json;
const cmd = (body, c = owner) => c.post('/api/companions', body);

/** A live connection as the owner (its player), collecting text messages. */
function conn(client) {
  const w = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: client.cookie } });
  const c = { w, msgs: [] };
  w.onmessage = e => { if (typeof e.data === 'string') c.msgs.push(JSON.parse(e.data)); };
  c.opened = new Promise((res, rej) => { w.onopen = res; w.onerror = () => rej(new Error('ws error')); });
  c.send = o => w.send(JSON.stringify(o));
  c.msg = (pred, ms) => waitFor(() => c.msgs.find(pred), ms);
  return c;
}
/** Walks the player toward (tx, tz) in steps the server accepts; returns where it ended. */
async function walk(from, tx, tz, steps = 60) {
  let x = from.x, z = from.z;
  for (let k = 0; k < steps; k++) {
    const d = Math.hypot(tx - x, tz - z);
    if (d < 0.3) break;
    const nx = x + (tx - x) / d * Math.min(0.4, d), nz = z + (tz - z) / d * Math.min(0.4, d);
    if (!nav.ok(nx, nz, -1)) break;
    x = nx; z = nz;
    ws.send({ t: 'pmove', x, y: 0.15, z, yaw: 0, ctx: -1, clip: 1, flags: 0, seq: (walk.seq = (walk.seq || 0) + 1) & 65535 });
    await wait(90);
  }
  return { x, z };
}

before(async () => {
  s = await startServer({ population: 220, agents: 5 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  world = (await owner.get('/api/world')).json.world;
  nav = new PlayerNav(world);
  ag = (await owner.get('/api/agents')).json.agents;
  ws = conn(owner); await ws.opened;
  const you = await ws.msg(m => m.t === 'you');
  ws.send({ t: 'pobserve', on: false });
  me = { x: you.x, z: you.z };
  assert.equal((await owner.post('/api/clock', { rate: 20 })).status, 200);   // (bodies walk 20× faster)
});
after(async () => { try { ws?.w.close(); } catch { /* closed */ } await s?.stop(); });

test('"follow me": it comes to the player and stays with it as it walks; others cannot command it', async () => {
  const A = ag[0];
  const r = await cmd({ agent: A.id, action: 'follow', target: 'me' });
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.text, /with you/);
  assert.equal(r.json.companion.kind, 'follow');
  const near = await waitFor(async () => { const x = await info(A.i); return x.pos.ctx === -1 && Math.hypot(x.pos.x - me.x, x.pos.z - me.z) < 4 ? x : null; }, 40000);
  assert.ok(near, 'it reached the player');
  assert.equal(near.act.kind, 'follow');
  assert.match(near.act.label, /With /);
  // the player walks on: it keeps up
  const goal = (() => { for (const [dx, dz] of [[12, 0], [-12, 0], [0, 12], [0, -12]]) if (nav.ok(me.x + dx, me.z + dz, -1)) return { x: me.x + dx, z: me.z + dz }; return null; })();
  assert.ok(goal, 'somewhere to walk');
  me = await walk(me, goal.x, goal.z);
  const kept = await waitFor(async () => { const x = await info(A.i); return Math.hypot(x.pos.x - me.x, x.pos.z - me.z) < 4.5 ? x : null; }, 20000);
  assert.ok(kept, 'it followed the player');
  const l = await list();
  assert.equal(l.following, 1);
  assert.equal(l.max, 3);
  assert.ok(l.companions.some(c => c.agent === A.id && c.state === 'following' && c.leader.kind === 'player'));
  // not hers: as if it weren't there
  assert.equal((await cmd({ agent: A.id, action: 'dismiss' }, ann)).status, 404);
  assert.equal((await list(ann)).companions.length, 0);
});

test('sim mode: the player\'s body parked, its companion waits beside it, and walks on with it again', async () => {
  const A = ag[0];
  ws.send({ t: 'pobserve', on: true });
  const w8 = await waitFor(async () => (await list()).companions.find(c => c.agent === A.id && c.state === 'waiting'), 10000);
  assert.ok(w8, 'waiting beside the parked body');
  ws.send({ t: 'pobserve', on: false });
  const back = await waitFor(async () => (await list()).companions.find(c => c.agent === A.id && c.state === 'following'), 10000);
  assert.ok(back, 'following again in Play mode');
});

test('at most three follow one player; the fourth is refused until one is dismissed', async () => {
  for (const A of ag.slice(1, 3)) assert.equal((await cmd({ agent: A.id, action: 'come' })).status, 200);
  const r = await cmd({ agent: ag[3].id, action: 'follow', target: 'me' });
  assert.deepEqual([r.status, r.json.code], [409, 'full'], r.text);
  const d = await cmd({ agent: ag[2].id, action: 'dismiss' });
  assert.equal(d.status, 200, d.text);
  assert.equal(d.json.dismissed, true);
  const x = await waitFor(async () => { const v = await info(ag[2].i); return v.act?.kind !== 'follow' ? v : null; }, 10000);
  assert.ok(x, 'dismissed: back to its own day');
  assert.equal((await cmd({ agent: ag[3].id, action: 'follow', target: 'me' })).status, 200);
  assert.equal((await list()).following, 3);
  for (const A of ag.slice(1, 4)) await cmd({ agent: A.id, action: 'dismiss' });
});

test('go with another of its owner\'s agents: it joins that one\'s group (the player leading it)', async () => {
  const r = await cmd({ agent: ag[1].id, action: 'follow', target: ag[0].name });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.companion.leader.kind, 'player', 'its friend follows the player: the player leads the group');
  await cmd({ agent: ag[1].id, action: 'dismiss' });
  await cmd({ agent: ag[0].id, action: 'dismiss' });
  // with an agent who leads itself: that agent leads
  const r2 = await cmd({ agent: ag[1].id, action: 'follow', target: ag[2].name });
  assert.equal(r2.status, 200, r2.text);
  assert.equal(r2.json.companion.leader.kind, 'agent');
  assert.equal(r2.json.companion.leader.agent, ag[2].id);
  const near = await waitFor(async () => { const a = await info(ag[1].i), b = await info(ag[2].i); return a.pos.ctx === b.pos.ctx && Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) < 5 ? a : null; }, 40000);
  assert.ok(near, 'it went over to the other agent');
  await cmd({ agent: ag[1].id, action: 'dismiss' });
});

test('wait here, and a meet-up of two at one place', async () => {
  const st = await cmd({ agent: ag[3].id, action: 'stay' });
  assert.equal(st.status, 200, st.text);
  assert.equal(st.json.companion.kind, 'hold');
  // a meet-up at a spot on open ground near the player
  const m = await cmd({ action: 'meetup', agents: [ag[3].id, ag[4].id], spot: { x: me.x, z: me.z, ctx: -1 } });
  assert.equal(m.status, 200, m.text);
  assert.equal(m.json.members.filter(x => x.ok).length, 2);
  const l = await list();
  const g = l.companions.filter(c => c.group === m.json.group);
  assert.equal(g.length, 2);
  assert.ok(g.every(c => c.state === 'meetup'));
  const there = await waitFor(async () => { const a = await info(ag[3].i), b = await info(ag[4].i); return Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) < 6 && Math.hypot(a.pos.x - me.x, a.pos.z - me.z) < 6 ? a : null; }, 60000);
  assert.ok(there, 'both went to the meet-up');
  assert.match(there.act.label, /Meeting up at /);
  // a place that isn't there
  assert.equal((await cmd({ agent: ag[3].id, action: 'go', place: 'Nowhere Land 999' })).json.code, 'no_place');
  const all = await owner.post('/api/companions/dismiss-all', {});
  assert.equal(all.status, 200, all.text);
  assert.ok(all.json.dismissed.length >= 2);
  assert.equal((await list()).companions.length, 0);
});
