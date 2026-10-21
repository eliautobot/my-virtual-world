// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Play modules over HTTP on a real server (docs/features/play-modules.md): anyone sees the modules and the leaderboards;
// a member sees profiles and edits only the own; a run starts only where its module lives (an airport); guests play nothing.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann, bob;
before(async () => {
  s = await startServer({ population: 60, agents: 0 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann' });
  bob = await userSession(s, owner, { login: 'bob', displayName: 'Bob' });
});
after(async () => { await s?.stop(); });
const guest = p => fetch(new URL(p, s.url)).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));

test('the modules, the badges and the leaderboards are public; profiles need a member; a guest cannot play', async () => {
  const g = await guest('/api/play');
  assert.equal(g.status, 200);
  const air = g.json.modules.find(m => m.id === 'airport');
  assert.equal(air.courses.length, 10);
  assert.ok(g.json.badges.some(b => b.id === 'top_gun') && g.json.badges.some(b => b.id === 'first_play'));
  assert.equal(air.verify, undefined, 'no functions or rules leave the server');
  assert.equal((await guest('/api/play/leaderboard?module=airport&course=first-flight')).json.rows.length, 0);
  assert.equal((await guest('/api/play/leaderboard?module=airport&course=nope')).status, 404);
  assert.equal((await guest('/api/play/profile')).status, 401);
  const st = await fetch(new URL('/api/play/start', s.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"module":"airport","course":"first-flight"}' });
  assert.ok([401, 403].includes(st.status));
});

test('a member\'s profile: the own one edits, another\'s only reads; a run starts only at an airport', async () => {
  const me = await ann.get('/api/play/profile');
  assert.equal(me.status, 200);
  assert.equal(me.json.name, 'Ann'); assert.equal(me.json.own, true); assert.equal(me.json.level, 1); assert.equal(me.json.rank.id, 'rookie');
  assert.deepEqual(me.json.modules.airport.unlocked, ['first-flight']);
  const set = await ann.post('/api/play/profile', { bio: 'Hello from the sky' });
  assert.equal(set.status, 200); assert.equal(set.json.bio, 'Hello from the sky');
  assert.equal((await ann.post('/api/play/profile', { showcase: ['top_gun'] })).status, 400, 'only earned badges');
  const seen = await bob.get(`/api/play/profile?id=${me.json.id}`);
  assert.equal(seen.json.bio, 'Hello from the sky'); assert.equal(seen.json.own, false);
  assert.equal((await bob.get('/api/play/profile?id=999999')).status, 404);
  const run = await ann.post('/api/play/start', { module: 'airport', course: 'first-flight' });
  assert.equal(run.status, 409, 'no airport here yet'); assert.equal(run.json.code, 'not_here');
  assert.equal((await ann.post('/api/play/start', { module: 'airport', course: 'ace-gauntlet' })).status, 403, 'a locked course');
  assert.equal((await ann.post('/api/play/finish', { run: 'nope', report: {} })).status, 404);
});

test('with the economy on, every course shows what it pays and each member sees today\'s winnings and the cap', async () => {
  assert.equal((await guest('/api/play')).json.modules.find(m => m.id === 'airport').prizes, null, 'no economy: no prizes');
  assert.equal((await owner.post('/api/economy/admin/switch', { name: 'enabled', on: true })).status, 200);
  const air = (await guest('/api/play')).json.modules.find(m => m.id === 'airport');
  assert.equal(air.prizes['first-flight'], 2100); assert.equal(air.prizes['ace-gauntlet'], 21000);
  const w = await ann.get('/api/play/winnings');
  assert.deepEqual(w.json, { today: 0, total: 0, cap: 40000, on: true });
  const pol = await owner.post('/api/economy/admin/policy', { policy: { play: { base: 600, dailyCap: 100000 } } });
  assert.equal(pol.status, 200, JSON.stringify(pol.json));
  assert.equal((await guest('/api/play')).json.modules.find(m => m.id === 'airport').prizes['first-flight'], 4200, 'administrators set the prizes');
  assert.equal((await ann.get('/api/play/winnings')).json.cap, 100000);
});
