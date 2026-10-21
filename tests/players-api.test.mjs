// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The multiplayer core over the live stream (PLAN WP1.10, I14.9–I14.12, DECISIONS C62, C118) with real WebSockets:
// one player per account shared by its tabs, moves validated and corrected, area of interest with measured rates,
// proximity chat by distance and space, online status with Appear offline, friends, and state saved across a restart.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, test } from 'node:test';
import { PlayerNav } from '../shared/playernav.js';
import { toWorld } from '../shared/geom.js';
import { normalizeSpec, checkBuilding } from '../shared/edit.js';
import { decodePlayers, PF_OBSERVING, PF_OUT, PF_YOU } from '../shared/playerproto.js';
import { startServer, ownerSession, userSession, httpClient } from './helpers/server.mjs';

let s, owner, ada, ben, cy, eve, nav, world;
before(async () => {
  s = await startServer({ population: 150 });
  owner = await ownerSession(s);
  ada = await userSession(s, owner, { login: 'ada', displayName: 'Ada', role: 'member' });
  ben = await userSession(s, owner, { login: 'ben', displayName: 'Ben', role: 'member' });
  cy = await userSession(s, owner, { login: 'cy', displayName: 'Cy', role: 'admin' });
  eve = await userSession(s, owner, { login: 'eve', displayName: 'Eve', role: 'admin' });
  world = (await owner.get('/api/world')).json.world;
  nav = new PlayerNav(world);
});
after(async () => { await s?.stop(); });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 6000) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(30); }
}
/** A live connection with a client's cookie (none: a guest). Collects text messages and decoded player entries. */
function conn(client) {
  const ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', client && client.cookie ? { headers: { cookie: client.cookie } } : undefined);
  ws.binaryType = 'arraybuffer';
  const c = { ws, msgs: [], players: [], frames: 0, bytes: 0 };
  ws.onmessage = e => {
    if (typeof e.data === 'string') { c.msgs.push(JSON.parse(e.data)); return; }
    if (new DataView(e.data).getUint8(0) !== 2) return;
    c.frames++; c.bytes += e.data.byteLength;
    decodePlayers(e.data, (p, t) => c.players.push({ ...p, at: Date.now(), t }));
  };
  c.opened = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  c.send = o => ws.send(JSON.stringify(o));
  c.msg = (pred, ms) => waitFor(() => c.msgs.find(pred), ms);
  c.last = (t) => [...c.msgs].reverse().find(m => m.t === t);
  c.close = () => { try { ws.close(); } catch { /* */ } };
  return c;
}
/** Walks a player from its position toward (tx, tz) in small steps the validator accepts; returns where it ended. */
async function walk(c, from, tx, tz, { steps = 40, step = 0.35 } = {}) {
  let x = from.x, z = from.z;
  for (let k = 0; k < steps; k++) {
    const d = Math.hypot(tx - x, tz - z);
    if (d < 0.3) break;
    let nx = x + (tx - x) / d * Math.min(step, d), nz = z + (tz - z) / d * Math.min(step, d);
    if (!nav.ok(nx, nz, -1)) break;
    x = nx; z = nz;
    c.send({ t: 'pmove', x, y: 0.15, z, yaw: 0, ctx: -1, clip: 1, flags: 0, seq: k + 1 });
    await sleep(90);
  }
  return { x, z };
}
/** Just outside (out) and just inside the walls (inn) of one side of a building, with the outside point walkable. */
function facade(B) {
  for (const [lx, lz, ix, iz] of [[0, -B.d / 2 - 0.45, 0, -B.d / 2 + 0.55], [B.w / 2 + 0.45, 0, B.w / 2 - 0.55, 0], [-B.w / 2 - 0.45, 0, -B.w / 2 + 0.55, 0]]) {
    const out = toWorld(B, lx, lz), inn = toWorld(B, ix, iz);
    if (nav.ok(out.x, out.z, -1) && !nav.ok(inn.x, inn.z, -1)) return { out, inn };
  }
  return null;
}
/** Warps an admin's player and returns where the server put it (the nearest valid spot when it moved it). */
async function place(c, x, z, ctx = -1) {
  const n = c.msgs.length;
  c.send({ t: 'pwarp', x, z, ctx });
  await sleep(250);
  const corr = c.msgs.slice(n).find(m => m.t === 'pcorr');
  return corr ? { x: corr.x, z: corr.z, ctx: corr.ctx } : { x, z, ctx };
}
/** Waits until an account's player has left the world (after the reload grace). */
const gone = name => waitFor(async () => !(await owner.get('/api/players/online')).json.list.some(p => p.name === name), 12000);
/** A walkable outdoor spot about r metres from (x, z). */
function spotNear(x, z, r) {
  for (let a = 0; a < Math.PI * 2; a += 0.2) { const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (nav.ok(px, pz, -1)) return { x: px, z: pz }; }
  return null;
}

test('one player per account, shared by its tabs; guests have none but see players; observing and fade-out (I14.9)', async () => {
  const a1 = conn(ada), a2 = conn(ada), g = conn(null);
  await Promise.all([a1.opened, a2.opened, g.opened]);
  const y1 = await a1.msg(m => m.t === 'you'), y2 = await a2.msg(m => m.t === 'you');
  assert.ok(y1 && y2, 'each tab hears about its player');
  assert.equal(y1.pid, y2.pid, 'both tabs share one player');
  assert.ok(nav.ok(y1.x, y1.z, y1.ctx), 'it appears on a valid spot (the spawn point)');
  await sleep(300);
  assert.equal(g.msgs.some(m => m.t === 'you'), false, 'a guest has no player');
  g.send({ t: 'pview', x: y1.x, z: y1.z });
  assert.ok(await waitFor(() => g.players.find(p => p.pid === y1.pid)), 'a guest sees players near where it looks');
  assert.ok(await g.msg(m => m.t === 'pinfo' && m.pid === y1.pid && m.name === 'Ada'), 'with the display name for the tag');
  assert.ok(g.players.find(p => p.pid === y1.pid).flags & PF_OBSERVING, 'a player not in play mode is observing');
  a1.send({ t: 'pobserve', on: false });
  assert.ok(await waitFor(() => g.players.find(p => p.pid === y1.pid && !(p.flags & PF_OBSERVING))), 'entering play mode clears the marker');
  assert.ok(await waitFor(() => a2.players.find(p => p.pid === y1.pid && (p.flags & PF_YOU))), 'the other tab sees its own player, marked as its own');
  const gs = conn(null); await gs.opened;   // guests are refused every player message
  gs.send({ t: 'pmove', x: 0, z: 0, ctx: -1 });
  assert.ok(await gs.msg(m => m.t === 'error' && m.code === 'forbidden' && m.of === 'pmove'));
  a1.close(); a2.close();
  assert.ok(await waitFor(() => g.players.find(p => p.pid === y1.pid && (p.flags & PF_OUT)), 9000), 'it fades out when its person closes the app');
  g.close(); gs.close();
});

test('the server accepts honest moves, refuses impossible ones and corrects the player (I14.10)', async () => {
  const c = conn(ben); await c.opened;
  const me = await c.msg(m => m.t === 'you');
  c.send({ t: 'pobserve', on: false });
  const target = spotNear(me.x, me.z, 5);
  assert.ok(target, 'somewhere to walk');
  const end = await walk(c, me, target.x, target.z);
  await sleep(250);
  const h1 = (await owner.get('/api/health')).json.players;
  assert.ok(h1.moves >= 5, `honest steps are accepted (${h1.moves})`);
  assert.equal(c.msgs.filter(m => m.t === 'pcorr').length, 0, 'and never corrected');
  // too fast: 40 m in one step
  c.send({ t: 'pmove', x: end.x + 40, y: 0.15, z: end.z, yaw: 0, ctx: -1, clip: 2, flags: 0, seq: 500 });
  const corr = await c.msg(m => m.t === 'pcorr' && m.why === 'too_fast');
  assert.ok(corr, 'a teleport is refused as too fast');
  assert.ok(Math.hypot(corr.x - end.x, corr.z - end.z) < 1, 'and the player is put back where it was');
  // into a building's walls
  await sleep(300);
  const B = world.buildings.find(b => b && !b.gone && b.type === 'office' && Math.hypot(b.x - end.x, b.z - end.z) > 5);
  const inside = { x: B.x, z: B.z };
  c.send({ t: 'pwarp', x: inside.x, z: inside.z, ctx: -1 });   // members cannot warp
  assert.ok(await c.msg(m => m.t === 'error' && m.of === 'pwarp'), 'only admins may put their player anywhere');
  // through a facade: stand right outside a building (an admin may place itself), then take one short step in
  const B2 = world.buildings.find(b => b && !b.gone && (b.type === 'office' || b.type === 'shop') && facade(b));
  const F = facade(B2);
  const k = conn(cy); await k.opened; await k.msg(m => m.t === 'you');
  k.send({ t: 'pobserve', on: false });
  const at = await place(k, F.out.x, F.out.z);
  assert.ok(Math.hypot(at.x - F.out.x, at.z - F.out.z) < 0.01, 'the admin stands right outside the facade');
  k.send({ t: 'pmove', x: F.inn.x, y: 0.15, z: F.inn.z, yaw: 0, ctx: -1, clip: 1, flags: 0, seq: 9 });
  const wall = await k.msg(m => m.t === 'pcorr' && m.seq !== undefined && m.why);
  assert.equal(wall && wall.why, 'blocked', 'a one-metre step into a building\'s walls is refused');
  assert.ok(Math.hypot(wall.x - F.out.x, wall.z - F.out.z) < 0.01, 'and the player stays outside');
  await sleep(300);   // one correction a quarter second
  k.send({ t: 'pmove', x: F.out.x, y: 3.55, z: F.out.z, yaw: 0, ctx: B2.idx * 64 + 1, clip: 1, flags: 0, seq: 10 });
  assert.ok(await k.msg(m => m.t === 'pcorr' && (m.why === 'no_door' || m.why === 'no_elevator')), 'going up a floor without a door or an elevator is refused');
  c.close(); k.close();
});

test('area of interest: full rate within 60 m, reduced within 250 m, nothing beyond - measured (I14.11)', async () => {
  const mover = conn(cy), near = conn(ada), mid = conn(ben), far = conn(null);
  await Promise.all([mover.opened, near.opened, mid.opened, far.opened]);
  const me = await mover.msg(m => m.t === 'you');
  const g = nav.g, cx = (g.minX + g.maxX) / 2, cz = (g.minZ + g.maxZ) / 2;
  const home = nav.openGround(cx, cz);
  mover.send({ t: 'pwarp', x: home.x, z: home.z, ctx: -1 });
  mover.send({ t: 'pobserve', on: false });
  await sleep(300);
  near.send({ t: 'pview', x: home.x + 20, z: home.z });
  mid.send({ t: 'pview', x: home.x + 150, z: home.z });
  far.send({ t: 'pview', x: home.x + 400, z: home.z + 400 });
  await sleep(400);
  const t0 = Date.now(), n0 = { near: near.players.length, mid: mid.players.length, far: far.players.length };
  // walk back and forth for about 3 s (every state changes)
  let x = home.x, dir = 1;
  const stop = Date.now() + 3000;
  let seq = 100;
  while (Date.now() < stop) {
    let nx = x + dir * 0.35;
    if (!nav.ok(nx, home.z, -1) || Math.abs(nx - home.x) > 3) { dir = -dir; nx = x + dir * 0.35; }
    x = nx;
    mover.send({ t: 'pmove', x, y: 0.15, z: home.z, yaw: 0, ctx: -1, clip: 1, flags: 0, seq: seq++ });
    await sleep(95);
  }
  await sleep(200);
  const secs = (Date.now() - t0) / 1000, of = (c, k) => c.players.slice(n0[k]).filter(p => p.pid === me.pid && !(p.flags & PF_OUT)).length / secs;
  const rNear = of(near, 'near'), rMid = of(mid, 'mid'), rFar = of(far, 'far');
  assert.ok(rNear >= 7, `within 60 m: about 10 updates a second (measured ${rNear.toFixed(1)}/s)`);
  assert.ok(rMid >= 1 && rMid <= 3.2, `within 250 m: about 2 a second (measured ${rMid.toFixed(1)}/s)`);
  assert.equal(rFar, 0, 'beyond 250 m: no updates at all');
  // the far browser still has the name in the online list (members) - the guest has no list
  assert.equal(far.msgs.some(m => m.t === 'online'), false, 'guests get no online list (C118)');
  const list = near.last('online');
  assert.ok(list && list.list.some(p => p.name === 'Cy'), 'a member sees everyone online by name, near or far');
  for (const c of [mover, near, mid, far]) c.close();
});

test('proximity chat reaches players within 20 m in the same space, and nobody else (C118)', async () => {
  const o = conn(owner), c = conn(cy), e = conn(eve), a = conn(ada);
  await Promise.all([o.opened, c.opened, e.opened, a.opened]);
  await Promise.all([o.msg(m => m.t === 'you'), c.msg(m => m.t === 'you'), e.msg(m => m.t === 'you'), a.msg(m => m.t === 'you')]);
  // a building with its facade walkable: the speaker stands outside it, a listener 6 m away outside, another inside on
  // the first floor above (within 20 m but not the same space), and Eve 60 m away
  const B = world.buildings.find(b => b && !b.gone && b.type === 'office' && b.floors >= 2 && b.d <= 26 && b.w <= 26 && facade(b));
  const F = facade(B);
  const speaker = await place(o, F.out.x, F.out.z);
  const n6 = spotNear(speaker.x, speaker.z, 6), n60 = spotNear(speaker.x, speaker.z, 60);
  const near = await place(c, n6.x, n6.z);
  const inside = await place(e, B.x, B.z, B.idx * 64 + 1);
  const dIn = Math.hypot(inside.x - speaker.x, inside.z - speaker.z);
  assert.equal(inside.ctx, B.idx * 64 + 1, 'Eve stands on the first floor');
  assert.ok(dIn <= 20, `Eve is within 20 m of the speaker (${dIn.toFixed(1)} m), only in another space`);
  o.send({ t: 'say', text: 'hello neighbours' });
  assert.ok(await o.msg(m => m.t === 'chat' && m.text === 'hello neighbours'), 'the speaker sees its own line');
  const heard = await c.msg(m => m.t === 'chat' && m.text === 'hello neighbours');
  assert.ok(heard, `a player ${Math.hypot(near.x - speaker.x, near.z - speaker.z).toFixed(1)} m away outside hears it`);
  assert.ok(typeof heard.name === 'string' && heard.name.length > 0 && heard.ctx === -1, 'with the speaker named and the space it spoke in');
  await sleep(300);
  assert.equal(e.msgs.some(m => m.t === 'chat'), false, 'a player on a floor above, 20 m or closer, hears nothing (another space)');
  const far = await place(e, n60.x, n60.z);
  assert.ok(Math.hypot(far.x - speaker.x, far.z - speaker.z) > 40);
  o.send({ t: 'say', text: 'still there?' });
  assert.ok(await c.msg(m => m.t === 'chat' && m.text === 'still there?'));
  await sleep(300);
  assert.equal(e.msgs.some(m => m.t === 'chat'), false, 'a player 60 m away hears nothing');
  // safety now: length and rate (a member speaks)
  a.send({ t: 'say', text: 'x'.repeat(300) });
  assert.ok(await a.msg(m => m.t === 'chat_refused' && /280/.test(m.why)), 'long messages are refused');
  for (let k = 0; k < 6; k++) a.send({ t: 'say', text: `spam ${k}` });
  assert.ok(await a.msg(m => m.t === 'chat_refused' && /Slow down/.test(m.why)), 'a burst is rate-limited');
  // the admin switch
  await owner.post('/api/auth/reauth', { password: owner.password });
  assert.equal((await owner.post('/api/settings', { values: { 'chat.proximity': false } })).status, 200);
  c.send({ t: 'say', text: 'anyone?' });
  assert.ok(await c.msg(m => m.t === 'chat_refused' && /turned off/.test(m.why)), 'an admin can turn proximity chat off');
  assert.equal((await owner.post('/api/settings', { values: { 'chat.proximity': true } })).status, 200);
  for (const x of [o, c, e, a]) x.close();
});

test('Appear offline hides an account from the online list and friends, but not from admins (C118)', async () => {
  const a = conn(ada), b = conn(ben), k = conn(cy);
  await Promise.all([a.opened, b.opened, k.opened]);
  await Promise.all([a.msg(m => m.t === 'you'), b.msg(m => m.t === 'you'), k.msg(m => m.t === 'you')]);
  const names = c => (c.last('online')?.list || []).map(p => p.name);
  assert.ok(await waitFor(() => names(b).includes('Ada')), 'Ben sees Ada online');
  assert.equal((await ada.post('/api/account/settings', { values: { 'social.status': 'invisible' } })).status, 200);
  assert.ok(await waitFor(() => !names(b).includes('Ada')), 'after Appear offline Ben no longer sees her');
  assert.ok(await waitFor(() => (k.last('online')?.list || []).some(p => p.name === 'Ada' && p.invisible)), 'an admin still sees her, marked');
  assert.ok(await waitFor(() => (a.last('online')?.list || []).some(p => p.name === 'Ada' && p.you)), 'she still sees herself');
  assert.equal((await ben.get('/api/players/online')).json.list.some(p => p.name === 'Ada'), false, 'the HTTP list agrees');
  assert.equal((await fetch(s.url + '/api/players/online')).status, 401, 'guests get no list');
  assert.equal((await ada.post('/api/account/settings', { values: { 'social.status': 'online' } })).status, 200);
  assert.ok(await waitFor(() => names(b).includes('Ada')), 'back online, she is listed again');
  for (const x of [a, b, k]) x.close();
});

test('friends: request, accept, remove; friends come first and hear when a friend comes online (C118)', async () => {
  const r = await ada.post('/api/friends/request', { name: 'ben' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.state, 'pending');
  assert.equal((await ada.post('/api/friends/request', { name: 'Ben' })).json.code, 'already_asked');
  assert.equal((await ada.post('/api/friends/request', { name: 'Nobody Here' })).status, 404);
  assert.equal((await ada.post('/api/friends/request', { name: 'Ada' })).json.code, 'self');
  const bl = (await ben.get('/api/friends')).json;
  assert.deepEqual(bl.incoming.map(f => f.name), ['Ada'], 'Ben has a request to answer');
  assert.deepEqual((await ada.get('/api/friends')).json.outgoing.map(f => f.name), ['Ben']);
  assert.equal((await ben.post('/api/friends/accept', { id: bl.incoming[0].id })).json.state, 'friends');
  assert.deepEqual((await ada.get('/api/friends')).json.friends.map(f => f.name), ['Ben'], 'friendship is mutual');
  // friends first in the online list, and a notice when the friend comes online
  assert.ok(await gone('Ada'), 'Ada\'s player from the earlier test has left');
  const b = conn(ben), k = conn(cy); await Promise.all([b.opened, k.opened]);
  await b.msg(m => m.t === 'you');
  const a = conn(ada); await a.opened;
  assert.ok(await b.msg(m => m.t === 'friend_online' && m.name === 'Ada'), 'Ben hears that his friend Ada came online');
  assert.ok(await waitFor(() => { const l = b.last('online')?.list || []; return l.length >= 3 && l[0].you && l[1].name === 'Ada' && l[1].friend; }), 'friends come right after yourself');
  // appearing offline: no notice
  a.close(); assert.ok(await gone('Ada'), 'she left');
  assert.equal((await ada.post('/api/account/settings', { values: { 'social.status': 'invisible' } })).status, 200);
  const before = b.msgs.filter(m => m.t === 'friend_online').length;
  const a2 = conn(ada); await a2.opened; await a2.msg(m => m.t === 'you');
  await sleep(700);
  assert.equal(b.msgs.filter(m => m.t === 'friend_online').length, before, 'no notice while she appears offline');
  await ada.post('/api/account/settings', { values: { 'social.status': 'online' } });
  assert.ok(await waitFor(() => b.msgs.filter(m => m.t === 'friend_online').length > before), 'showing up is announced');
  // remove
  assert.equal((await ben.post('/api/friends/remove', { name: 'Ada' })).json.was, 'removed');
  assert.deepEqual((await ada.get('/api/friends')).json.friends, []);
  // decline and cancel
  await ada.post('/api/friends/request', { name: 'Cy' });
  assert.equal((await ada.post('/api/friends/remove', { name: 'Cy' })).json.was, 'cancelled');
  await ada.post('/api/friends/request', { name: 'Cy' });
  assert.equal((await cy.post('/api/friends/remove', { name: 'Ada' })).json.was, 'declined');
  for (const x of [b, k, a2]) x.close();
});

test('an admin edit that covers a player moves it to the nearest valid spot, with a notice; new players appear at the spawn point (I14.12)', async () => {
  const k = conn(cy); await k.opened; await k.msg(m => m.t === 'you');
  // a free lot, the player in its middle, then a building placed over it
  let spec = null;
  const g = nav.g;
  for (let z = g.minZ + 12; z < g.maxZ - 12 && !spec; z += 2) for (let x = g.minX + 12; x < g.maxX - 12 && !spec; x += 2) {
    const sp = normalizeSpec({ type: 'cafe', w: 12, d: 14, floors: 1, style: 'modern', rot: 0, x, z });
    if (!checkBuilding(world, sp) && nav.ok(x, z, -1)) spec = sp;
  }
  assert.ok(spec, 'a free lot with open ground in its middle');
  const at = await place(k, spec.x, spec.z);
  assert.ok(Math.hypot(at.x - spec.x, at.z - spec.z) < 0.01, 'the admin stands in the middle of the lot');
  await owner.post('/api/auth/reauth', { password: owner.password });
  const r = await owner.post('/api/edit', { ops: [{ op: 'bld.add', spec: { ...spec, name: 'Over The Player' } }] });
  assert.equal(r.status, 200, r.text);
  const moved = await k.msg(m => m.t === 'pmoved');
  assert.ok(moved, 'the player is told it was moved');
  assert.match(moved.text, /moved to the nearest free spot/);
  const w2 = (await owner.get('/api/world')).json.world, nav2 = new PlayerNav(w2);
  assert.ok(nav2.ok(moved.x, moved.z, moved.ctx), 'to a spot that is valid in the changed world');
  assert.ok(Math.hypot(moved.x - spec.x, moved.z - spec.z) < 20, `and near where it was (${Math.hypot(moved.x - spec.x, moved.z - spec.z).toFixed(1)} m)`);
  await owner.post('/api/undo');
  k.close();
  // the spawn point: an admin setting; a brand-new player appears at the nearest open ground to it
  const sp = nav.openGround((g.minX + g.maxX) / 2 - 60, (g.minZ + g.maxZ) / 2 - 30);
  const set = await owner.post('/api/settings', { values: { 'players.spawn': JSON.stringify({ x: sp.x, z: sp.z }) } });
  assert.equal(set.status, 200, set.text);
  assert.equal((await ada.post('/api/settings', { values: { 'players.spawn': '' } })).status, 403, 'members cannot move it');
  const fay = await userSession(s, owner, { login: 'fay', displayName: 'Fay', role: 'member' });
  const f = conn(fay); await f.opened;
  const you = await f.msg(m => m.t === 'you');
  assert.ok(Math.hypot(you.x - sp.x, you.z - sp.z) < 0.01, 'a new player appears at the spawn point');
  assert.equal(you.fresh, true, 'and is told it is new (its browser uploads its look)');
  f.close();
  assert.equal((await owner.post('/api/settings', { values: { 'players.spawn': null } })).status, 200);
});

test('player state is saved per account and restored after a restart, on any device; a deleted account leaves (I14.12)', async () => {
  const s2 = await startServer({ population: 120 });
  let s3 = null;
  try {
    const o2 = await ownerSession(s2);
    const dan = await userSession(s2, o2, { login: 'dan', displayName: 'Dan', role: 'admin' });
    const w2 = (await o2.get('/api/world')).json.world, nav2 = new PlayerNav(w2);
    const spot = nav2.openGround((nav2.g.minX + nav2.g.maxX) / 2 - 40, (nav2.g.minZ + nav2.g.maxZ) / 2 + 20);
    const ws = new WebSocket(s2.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: dan.cookie } });
    const msgs = []; ws.onmessage = e => { if (typeof e.data === 'string') msgs.push(JSON.parse(e.data)); };
    await new Promise(r => { ws.onopen = r; });
    await waitFor(() => msgs.find(m => m.t === 'you'));
    ws.send(JSON.stringify({ t: 'pwarp', x: spot.x, z: spot.z, ctx: -1, yaw: 1.25 }));
    ws.send(JSON.stringify({ t: 'plook', app: { skin: '#aa7755', hair: '#112233' } }));
    ws.send(JSON.stringify({ t: 'pcam', dist: 17.5, pitch: 0.7 }));
    await sleep(300);
    ws.close();
    await s2.stop({ keepData: true });
    s3 = await startServer({ data: s2.data });
    const dan3 = Object.assign(httpClient(s3.url), { cookie: dan.cookie, csrf: dan.csrf });
    const ws3 = new WebSocket(s3.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: dan3.cookie } });
    const m3 = []; ws3.onmessage = e => { if (typeof e.data === 'string') m3.push(JSON.parse(e.data)); };
    await new Promise(r => { ws3.onopen = r; });
    const you = await waitFor(() => m3.find(m => m.t === 'you'));
    assert.ok(Math.abs(you.x - spot.x) < 0.01 && Math.abs(you.z - spot.z) < 0.01, 'it appears where it last stood');
    assert.equal(you.yaw, 1.25);
    assert.equal(you.look.skin, '#aa7755', 'with its look');
    assert.deepEqual(you.cam, { dist: 17.5, pitch: 0.7 }, 'and its camera preference');
    assert.equal(you.fresh, false);
    ws3.close();
    const o3 = Object.assign(httpClient(s3.url), { cookie: o2.cookie, csrf: o2.csrf });
    assert.equal((await o3.post('/api/users/delete', { id: dan.id })).status, 200);
    const exp = (await o3.get('/api/players/online')).json.list;
    assert.equal(exp.some(p => p.name === 'Dan'), false, 'a deleted account\'s player is gone');
  } finally {
    if (s3) await s3.stop(); else await s2.stop();
    fs.rmSync(s2.data, { recursive: true, force: true });
    fs.rmSync(`${s2.data}.key`, { force: true });
  }
});

test('a player still connected when the server stops is saved once, and nothing is written into the closed database after', async () => {
  const s2 = await startServer({ population: 120 });
  let s3 = null;
  try {
    const o2 = await ownerSession(s2);
    const eve = await userSession(s2, o2, { login: 'eve', displayName: 'Eve', role: 'admin' });
    const w2 = (await o2.get('/api/world')).json.world, nav2 = new PlayerNav(w2);
    const spot = nav2.openGround((nav2.g.minX + nav2.g.maxX) / 2 + 30, (nav2.g.minZ + nav2.g.maxZ) / 2 - 10);
    const ws = new WebSocket(s2.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: eve.cookie } });
    const msgs = []; ws.onmessage = e => { if (typeof e.data === 'string') msgs.push(JSON.parse(e.data)); };
    await new Promise(r => { ws.onopen = r; });
    await waitFor(() => msgs.find(m => m.t === 'you'));
    ws.send(JSON.stringify({ t: 'pwarp', x: spot.x, z: spot.z, ctx: -1, yaw: 0.5 }));
    await sleep(300);
    await s2.stop({ keepData: true });   // (the stream is still open: the shutdown closes it)
    assert.doesNotMatch(s2.log(), /\[players\] save failed|statement has been finalized/);
    assert.match(s2.log(), /\[shutdown\] done\n/, 'a clean shutdown');
    s3 = await startServer({ data: s2.data });
    const ws3 = new WebSocket(s3.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: eve.cookie } });
    const m3 = []; ws3.onmessage = e => { if (typeof e.data === 'string') m3.push(JSON.parse(e.data)); };
    await new Promise(r => { ws3.onopen = r; });
    const you = await waitFor(() => m3.find(m => m.t === 'you'));
    assert.ok(Math.abs(you.x - spot.x) < 0.01 && Math.abs(you.z - spot.z) < 0.01, 'its place was saved at the shutdown');
    ws3.close();
  } finally {
    if (s3) await s3.stop(); else await s2.stop();
    fs.rmSync(s2.data, { recursive: true, force: true });
    fs.rmSync(`${s2.data}.key`, { force: true });
  }
});

test('Go home: the starting point without a home, then inside the flat the account bought (phome)', async () => {
  const c = conn(ben); await c.opened;
  const y = await c.msg(m => m.t === 'you');
  c.send({ t: 'pobserve', on: false });
  c.send({ t: 'phome' });
  const m1 = await c.msg(m => m.t === 'pmoved' && m.home);
  assert.ok(m1 && m1.ctx === -1 && /no home yet/.test(m1.text), 'no flat and no lot: the starting point, with a notice');
  assert.ok(nav.ok(m1.x, m1.z, -1), 'on open ground');
  const B = world.buildings.find(b => b && !b.gone && b.type === 'apartment' && b.floors >= 2 && world.levels[b.lv[1]]?.units?.length);
  assert.equal((await owner.post('/api/edit', { ops: [{ op: 'flat.set', b: B.idx, f: 1, u: 0, deal: 'sold', owner: { kind: 'account', login: 'ben' } }] })).status, 200);
  await sleep(1600);   // one trip a second and a half
  c.msgs.length = 0;
  c.send({ t: 'phome' });
  const m2 = await c.msg(m => m.t === 'pmoved' && m.home);
  assert.ok(m2, 'answered');
  assert.equal(m2.ctx, B.idx * 64 + 1, 'inside the building, on the flat\'s floor');
  assert.match(m2.text, /flat 1/);
  c.send({ t: 'phome' });   // too soon: ignored
  await sleep(400);
  assert.equal(c.msgs.filter(m => m.t === 'pmoved').length, 1, 'a second press within 1.5 s does nothing');
  assert.ok(y);
  c.close();
});
