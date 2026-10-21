// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The residents follow the homes, on a real server (server/sim/housing.js, MVW_HOUSING on): a new world starts with its
// homes filled to Homes filled (30 % by default) - not MVW_POPULATION -; Settings → Residents reads the numbers
// (administrators only) and changes the share. How the city then settles is tests/unit/housing.test.mjs.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann;
before(async () => {
  s = await startServer({ population: 260, env: { MVW_HOUSING: 'on' } });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
});
after(async () => { await s?.stop(); });

test('a new world starts with its homes 30 % full, whatever MVW_POPULATION says; only administrators read the numbers', async () => {
  const p = (await owner.get('/api/population')).json;
  assert.ok(p.beds > 0, JSON.stringify(p));
  assert.equal(p.pct, 30);
  assert.equal(p.target, Math.round(p.beds * 0.3));
  const people = (await owner.get('/api/people')).json.people.filter(x => !x.x).length;
  assert.equal(people, p.target, `the residents: its homes × 30 % (${people}), not the 260 asked for`);
  assert.notEqual(people, 260);
  assert.equal(p.residents, people); assert.equal(p.homeless, 0, 'all of them housed');
  assert.equal((await ann.get('/api/population')).status, 403);
});

test('Homes filled is a setting: the target follows it at once', async () => {
  const r = await owner.post('/api/settings', { values: { 'world.homesFilled': 50 } });
  assert.equal(r.status, 200, r.text);
  const p = (await owner.get('/api/population')).json;
  assert.equal(p.pct, 50); assert.equal(p.target, Math.round(p.beds * 0.5));
  assert.equal((await owner.post('/api/settings', { values: { 'world.homesFilled': 150 } })).status, 400, 'a share is 0–100 %');
});

test('people moving in together (one batch of person.add, as the city moves them in) are each their own resident', async () => {
  const n0 = (await owner.get('/api/people')).json.people.length;
  const r = await owner.post('/api/edit', { ops: [{ op: 'person.add' }, { op: 'person.add' }, { op: 'person.add' }] });
  assert.equal(r.status, 200, r.text);
  const added = (await owner.get('/api/people')).json.people.slice(n0);
  assert.equal(added.length, 3);
  assert.equal(new Set(added.map(p => p.id)).size, 3, `three ids: ${added.map(p => p.id)}`);
  assert.ok(new Set(added.map(p => JSON.stringify([p.n, p.a]))).size > 1, 'not one face three times');
});
