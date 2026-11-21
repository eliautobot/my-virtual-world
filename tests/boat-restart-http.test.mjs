// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A boat out across a restart of a real server (server/world/boats.js; 2026-11-19, the product owner: the server restarted while he was
// out fishing — the boat gone, then a new one "wasn't moving"): out at sea when the server stops, it is out there again
// after it; its skipper's page, connecting again, is back at the helm (resumed) and drives on (its poses taken, no
// correction); a page driving a boat the harbour doesn't give it is told to let it go (bgone).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession, tempDir, ROOT, httpClient } from './helpers/server.mjs';
import { Island } from '../shared/terrain.js';
import { RoadNetwork } from '../shared/roads.js';
import { checkWorldModule, moduleDecks, deckUnder } from '../shared/world-modules.js';
import { fitToShore, DOCKS } from '../shared/dock-layout.js';
import { coastline, protectedWhy } from '../shared/coasts.js';
import { buildingPads } from '../shared/island-build.js';

let s, owner, dir;
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
  dir = tempDir('mvw-boat-restart-');
  const first = await startServer({ data: dir, population: 80 }); await first.stop();
  for (const tool of ['add-island', 'add-roads']) {
    const r = spawnSync(process.execPath, [`tools/wp4/${tool}.mjs`, '--data', dir, '--server-stopped'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  s = await startServer({ data: dir, population: 80 });
  owner = await ownerSession(s);
});
after(async () => { await s?.stop(); });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const conn = client => {
  const ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: client.cookie } }), c = { ws, msgs: [] };
  ws.onmessage = e => { if (typeof e.data === 'string') c.msgs.push(JSON.parse(e.data)); };
  c.opened = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  c.send = o => ws.send(JSON.stringify(o));
  c.msg = async (pred, ms = 6000) => { const t0 = Date.now(); for (;;) { const m = c.msgs.find(pred); if (m) return m; if (Date.now() - t0 > ms) return null; await sleep(30); } };
  return c;
};

test('out at sea when the server restarts: the boat out there again, its skipper back at the helm, driving on', async () => {
  const [spot] = await spotsFor('marina');
  assert.ok(spot);
  assert.equal((await edit(owner, [{ op: 'wmod.add', module: spot }])).status, 200);
  const w = await world(), { boatSlips } = await import('../shared/world-modules.js'), slip = boatSlips(w).find(x => x.kind === 'coastal');
  let o = conn(owner);
  await o.opened; await o.msg(m => m.t === 'you'); o.send({ t: 'pobserve', on: false });
  o.send({ t: 'pwarp', x: slip.deck.x, z: slip.deck.z, ctx: -1 }); await sleep(300);
  o.send({ t: 'bboard', id: slip.id });
  const st = await o.msg(m => m.t === 'bstate' && m.ok);
  assert.ok(st, 'took the boat');
  // out of the slip and away from it
  const h = st.pose.h; let x = st.pose.x, z = st.pose.z;
  for (let k = 0; k < 12; k++) { x += Math.sin(h) * 1.5; z += Math.cos(h) * 1.5; o.send({ t: 'bpose', x, y: st.pose.y, z, h, p: 0, r: 0, v: 6, l: 0.5 }); await sleep(110); }
  await sleep(300);
  o.ws.close();
  // the server restarts (its owner's session kept: the same cookie)
  await s.stop();
  s = await startServer({ data: dir, population: 80 });
  o = conn(owner);
  await o.opened; await o.msg(m => m.t === 'you');
  const back = await o.msg(m => m.t === 'bstate' && m.resumed);
  assert.ok(back, 'back at the helm');
  assert.equal(back.id, slip.id);
  assert.ok(Math.hypot(back.pose.x - x, back.pose.z - z) < 2, `where it was (${Math.hypot(back.pose.x - x, back.pose.z - z).toFixed(2)} m)`);
  // driving on: its poses taken (no correction), everyone near hearing it is out
  o.send({ t: 'pobserve', on: false });
  o.msgs.length = 0;
  for (let k = 0; k < 6; k++) { x += Math.sin(h) * 1.5; z += Math.cos(h) * 1.5; o.send({ t: 'bpose', x, y: back.pose.y, z, h, p: 0, r: 0, v: 6, l: 0.5 }); await sleep(110); }
  await sleep(300);
  assert.equal(o.msgs.filter(m => m.t === 'bcorr' || m.t === 'bgone').length, 0, 'it moves: no correction');
  // stopped, the harbour master's way home: off the helm when leaving Play mode — the boat back in its slip
  o.send({ t: 'bpose', x, y: back.pose.y, z, h, v: 0 }); await sleep(150);
  o.ws.close();
});

test('its page closed out at sea (past a reload\'s grace): the boat waits for its skipper, back at the helm when they are back — and asked again by a page that loaded late (bresync); a page still driving a boat the harbour doesn\'t give it: told to let it go', async () => {
  await sleep(6500);   // (its skipper's last page gone past the grace: the boat waits out there for them — 2026-11-20)
  let o = conn(owner);
  await o.opened; await o.msg(m => m.t === 'you'); o.send({ t: 'pobserve', on: false });
  const back = await o.msg(m => m.t === 'bstate' && m.resumed);
  assert.ok(back, 'the boat waited: back at the helm');
  // (a page whose boat module loaded after that message: it asks again, and is told the same)
  o.msgs.length = 0; o.send({ t: 'bresync' });
  const again = await o.msg(m => m.t === 'bstate');
  assert.ok(again?.ok && again.resumed && again.id === back.id, 'bresync: the same boat');
  // (fast travel while at the helm: "Leave the vehicle first" — truthfully)
  o.msgs.length = 0; o.send({ t: 'ptravel', x: back.pose.x + 200, z: back.pose.z });
  const no = await o.msg(m => m.t === 'pmoved' && m.travel);
  assert.match(no?.text || '', /Leave the vehicle first/);
  // leaving: the harbour master takes it home — then nothing to be back at, and a page still driving it is told so
  o.send({ t: 'bleave' }); await o.msg(m => m.t === 'pmoved' && m.boat === 'out');
  o.ws.close(); await sleep(300);
  o = conn(owner);
  await o.opened; await o.msg(m => m.t === 'you'); o.send({ t: 'pobserve', on: false });
  await sleep(400);
  assert.equal(o.msgs.some(m => m.t === 'bstate' && m.resumed), false, 'no boat to be back at');
  o.send({ t: 'bresync' });
  const none = await o.msg(m => m.t === 'bstate');
  assert.ok(none && !none.ok && none.none, 'bresync: none');
  o.msgs.length = 0;
  o.send({ t: 'bpose', x: 10, y: 0, z: 10, h: 0, v: 3 });
  const g = await o.msg(m => m.t === 'bgone');
  assert.ok(g, 'bgone');
  assert.match(g.text, /went back to its slip/);
  o.ws.close();
});

test('a reload out at sea on a fishing trip: back at the helm at once, the trip under way taken up again (/api/play/current) — and across a restart, the same trip, finished as one', async () => {
  // (the owner's session on the server as it is now — its address changes with each restart)
  const as = () => Object.assign(httpClient(s.url), { cookie: owner.cookie, csrf: owner.csrf });
  let api = as();
  const w = (await api.get('/api/world')).json.world, { boatSlips } = await import('../shared/world-modules.js'), slip = boatSlips(w).find(x => x.kind === 'coastal');
  let o = conn(owner);
  await o.opened; await o.msg(m => m.t === 'you'); o.send({ t: 'pobserve', on: false });
  o.send({ t: 'pwarp', x: slip.deck.x, z: slip.deck.z, ctx: -1 }); await sleep(300);
  o.send({ t: 'bboard', id: slip.id });
  const st = await o.msg(m => m.t === 'bstate' && m.ok);
  assert.ok(st, 'took the boat');
  const trip = await api.post('/api/play/start', { module: 'fishing', course: 'harbour-morning', where: st.module });
  assert.equal(trip.status, 200, trip.text);
  const h = st.pose.h; let x = st.pose.x, z = st.pose.z;
  for (let k = 0; k < 10; k++) { x += Math.sin(h) * 1.5; z += Math.cos(h) * 1.5; o.send({ t: 'bpose', x, y: st.pose.y, z, h, p: 0, r: 0, v: 6, l: 0.5 }); await sleep(110); }
  o.send({ t: 'bpose', x, y: st.pose.y, z, h, v: 0 }); await sleep(200);
  // a quick reload (within the grace: the same player)
  o.ws.close(); await sleep(200);
  o = conn(owner);
  await o.opened; await o.msg(m => m.t === 'you');
  const b1 = await o.msg(m => m.t === 'bstate' && m.resumed);
  assert.ok(b1 && b1.id === slip.id, 'a quick reload: back at the helm');
  const c1 = (await api.get('/api/play/current?module=fishing')).json.current;
  assert.ok(c1 && c1.run === trip.json.run && c1.course === 'harbour-morning' && c1.elapsed > 0, 'the trip under way, to take up again');
  assert.ok(Array.isArray(c1.state.caught) && c1.state.lures && !('secret' in c1) && !('secret' in (c1.state || {})), 'its catch so far and bait left — never its secret');
  // the server restarts: the trip is still the one under way
  o.ws.close();
  await s.stop();
  s = await startServer({ data: dir, population: 80 });
  api = as();
  o = conn(owner);
  await o.opened; await o.msg(m => m.t === 'you');
  assert.ok(await o.msg(m => m.t === 'bstate' && m.resumed), 'back at the helm after the restart');
  const c2 = (await api.get('/api/play/current?module=fishing')).json.current;
  assert.equal(c2?.run, trip.json.run, 'the same trip after the restart');
  assert.ok(c2.elapsed >= c1.elapsed, 'its clock went on');
  const fin = await api.post('/api/play/finish', { run: trip.json.run, report: {} });
  assert.equal(fin.status, 200, fin.text);
  assert.equal(fin.json.ok, true, 'weighed in as one trip');
  assert.equal((await api.get('/api/play/current?module=fishing')).json.current, null, 'nothing under way after');
  o.send({ t: 'bleave' }); await sleep(300);
  o.ws.close();
});
