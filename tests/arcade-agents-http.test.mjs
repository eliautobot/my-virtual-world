// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// AI agents at the arcade on a real server (server/play/arcade-crew.js): in an arcade (the Floor Themes' own), its owner
// sees each machine that plays a game among what its companion can do (GET /api/interactions?agent= — the furniture's
// plain 'play' at those machines is gone), tells it to play one (POST /api/interactions), and it does: its body at the
// machine, a run of the arcade module played in real time, checked by the module's verify and recorded under its name
// (the leaderboard, its profile), its owner's page told (crew_arcade).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PlayerNav } from '../shared/playernav.js';
import { WorldIndex } from '../server/sim/windex.js';
import { toWorld } from '../shared/geom.js';
import { ctxOf } from '../shared/constants.js';
import { machineGame } from '../shared/arcade/catalog.js';
import { startServer, ownerSession } from './helpers/server.mjs';

let s, owner, world, nav, ws, ag, arc;
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(250); } };
const info = async i => (await owner.get(`/api/agent/${i}`)).json;
let seq = 0;
const move = (x, z, ctx, flags = 0) => ws.send({ t: 'pmove', x, y: 0.15, z, yaw: 0, ctx, clip: 1, flags, seq: (seq = (seq + 1) & 65535) });

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
  s = await startServer({ population: 200, agents: 2 });
  owner = await ownerSession(s);
  const W = (await owner.get('/api/world')).json.world;
  const B = W.buildings.filter(b => b && !b.gone && (b.type === 'office' || b.type === 'hq') && b.floors >= 3).sort((a, b) => b.w * b.d - a.w * a.d)[0];
  assert.equal((await owner.post('/api/edit', { ops: [{ op: 'lvl.theme', b: B.idx, f: 1, theme: 'arcade' }] })).status, 200);
  world = (await owner.get('/api/world')).json.world;
  nav = new PlayerNav(world);
  ag = (await owner.get('/api/agents')).json.agents;
  arc = { b: B.idx, f: 1, ctx: ctxOf(B.idx, 1) };
  ws = conn(owner); await ws.opened;
  await ws.msg(m => m.t === 'you');
  ws.send({ t: 'pobserve', on: false });
  assert.equal((await owner.post('/api/clock', { rate: 20 })).status, 200);
});
after(async () => { try { ws?.w.close(); } catch { /* closed */ } await s?.stop(); });

test('its owner in the arcade: the machines\' games among what it can do; told to play one, it plays it for real — verified and recorded under its name', { timeout: 300000 }, async () => {
  const A = ag[0], B = world.buildings[arc.b], items = world.levels[B.lv[arc.f]].items, idx = new WorldIndex(world);
  // a machine whose game is a short one (a test on a real clock), its approach walkable
  const order = ['boxer', 'claw_machine', 'skeeball', 'hoop_shot', 'whack_mole', 'mech_bull'];
  const machines = items.filter(it => machineGame(it.t)).sort((x, y) => (order.indexOf(x.t) + 1 || 99) - (order.indexOf(y.t) + 1 || 99));
  let pick = null;
  for (const it of machines) {
    const e = idx.entry(arc.b, arc.f, it.id), s0 = e?.slots[0];
    if (!s0) continue;
    const ap = toWorld(B, s0.ax, s0.az);
    if (nav.ok(ap.x, ap.z, arc.ctx)) { pick = { it, ap, game: machineGame(it.t) }; break; }
  }
  assert.ok(pick, `a machine with a game in the arcade: ${items.map(i => i.t).join(',')}`);
  ws.send({ t: 'pwarp', x: pick.ap.x + 1.2, z: pick.ap.z, ctx: arc.ctx });
  await wait(400);
  move(pick.ap.x + 1.2, pick.ap.z, arc.ctx);
  assert.equal((await owner.post('/api/companions', { agent: A.id, action: 'follow', target: 'me' })).status, 200);
  assert.ok(await waitFor(async () => { const x = await info(A.i); return x.pos?.ctx === arc.ctx && Math.hypot(x.pos.x - pick.ap.x, x.pos.z - pick.ap.z) < 6; }, 90000), 'it came to its owner in the arcade');
  const g = await owner.get(`/api/interactions?agent=${A.id}`);
  assert.equal(g.status, 200, g.text);
  const things = g.json.things, id = `arcade:${arc.b}.${arc.f}.${pick.it.id}`;
  const mine = things.find(x => x.id === id);
  assert.ok(mine, `${pick.game.title} offered: ${things.map(x => `${x.id} ${x.label}`).join(' | ')}`);
  assert.match(mine.label, new RegExp(`^Play ${pick.game.title} on the .+ near .+ \\(you have not played it yet\\)`));
  assert.ok(!things.some(x => x.source === 'furniture' && x.kind === 'play' && x.id.startsWith(`furniture:${arc.b}.${arc.f}.${pick.it.id}.`)), 'no plain play at that machine');
  const r = await owner.post('/api/interactions', { agent: A.id, id });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ok, true);
  assert.match(r.json.brain, new RegExp(`to play ${pick.game.title} — a real game you play yourself`));
  // its body at the machine, playing: its Companions bar says so
  assert.ok(await waitFor(async () => (await owner.get('/api/companions')).json.companions?.find(c => c.agent === A.id)?.arcade?.playing, 60000), 'it is playing');
  // the game over: under its name on the board, in its profile, its owner told
  const board = await waitFor(async () => { const b = (await owner.get(`/api/play/leaderboard?module=arcade&course=${pick.game.id}`)).json; return b?.rows?.find(x => x.agent && x.id === -A.id) ? b : null; }, 240000);
  assert.ok(board, 'its score on the leaderboard');
  const row = board.rows.find(x => x.id === -A.id);
  assert.equal(row.name, A.name);
  const prof = (await owner.get(`/api/play/profile?id=${-A.id}`)).json;
  assert.equal(prof.modules.arcade.runs, 1, 'one game, its own');
  assert.equal(prof.modules.arcade.best[pick.game.id].score, row.score);
  const toast = await ws.msg(m => m.t === 'crew_arcade' && m.agent === A.id, 10000);
  assert.ok(toast, 'its owner\'s page told');
  assert.equal(toast.score, row.score);
  assert.match(toast.text, new RegExp(`^${A.name} scored [\\d,]+ on ${pick.game.title}`));
});
