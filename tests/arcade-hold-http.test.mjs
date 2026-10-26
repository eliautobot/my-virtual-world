// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// POST /api/arcade/hold (2026-10-26: agents walked up and played at a pool table a player was playing): a machine game or
// a cabinet holds its whole machine while it is open; one per account; another player finds it busy; let go, it is free;
// only arcade machines; signed-in players only.
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import { startServer, ownerSession, userSession, httpClient, tempDir } from './helpers/server.mjs';

let s, owner, ann, guest, dir, pool, cab;
before(async () => {
  dir = tempDir('mvw-arcade-hold-');
  s = await startServer({ data: path.join(dir, 'data'), population: 80 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  guest = httpClient(s.url);
  const W = (await owner.get('/api/world')).json.world;
  const B = W.buildings.filter(b => b && !b.gone && (b.type === 'office' || b.type === 'hq') && b.floors >= 3).sort((a, b) => b.w * b.d - a.w * a.d)[0];
  assert.equal((await owner.post('/api/edit', { ops: [{ op: 'lvl.theme', b: B.idx, f: 1, theme: 'arcade' }] })).status, 200);
  const W2 = (await owner.get('/api/world')).json.world, items = W2.levels[W2.buildings[B.idx].lv[1]].items;
  const p = items.find(i => i.t === 'pool_table') || items.find(i => i.t === 'air_hockey'), c = items.find(i => i.t === 'arcade');
  assert.ok(p && c, 'the arcade has a table and a cabinet');
  pool = { b: B.idx, f: 1, id: p.id }; cab = { b: B.idx, f: 1, id: c.id };
});
after(async () => { await s?.stop(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

test('a game holds its machine; another player finds it busy; let go, it is anyone\'s; cabinets too; only arcade machines; guests no', async () => {
  let r = await owner.post('/api/arcade/hold', { ...pool, on: true });
  assert.equal(r.status, 200, r.text); assert.equal(r.json.held, true);
  r = await ann.post('/api/arcade/hold', { ...pool, on: true });
  assert.equal(r.json.held, false); assert.equal(r.json.busy, true, 'another player: busy');
  r = await owner.post('/api/arcade/hold', { ...pool, on: false });
  assert.equal(r.json.held, false);
  r = await ann.post('/api/arcade/hold', { ...pool, on: true });
  assert.equal(r.json.held, true, 'let go: Ann has it');
  r = await ann.post('/api/arcade/hold', { ...cab, on: true });
  assert.equal(r.json.held, true, 'a cabinet: held (and the table let go: one each)');
  r = await owner.post('/api/arcade/hold', { ...pool, on: true });
  assert.equal(r.json.held, true, 'the table was let go when Ann moved to the cabinet');
  const W = (await owner.get('/api/world')).json.world, sofa = W.levels[W.buildings[pool.b].lv[1]].items.find(i => i.t !== 'arcade' && i.t !== 'pool_table' && i.t !== 'air_hockey' && i.t !== 'foosball' && !/hoop|skee|bowl|claw|pinball|whack|boxer|bull|dance|racing/.test(i.t));
  r = await owner.post('/api/arcade/hold', { b: pool.b, f: 1, id: sofa.id, on: true });
  assert.equal(r.status, 400, `not an arcade machine (${sofa.t}: ${r.status} ${r.text})`);
  assert.ok([401, 403].includes((await guest.post('/api/arcade/hold', { ...pool, on: true })).status), 'guests: no');
});
