// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's life on a real server (docs/features/FREE-WILL.md §5, §9): only its owner (or a manage share) reads or
// changes its profile, plans, memories, people and activity — everyone else gets 404, guests 401; the profile is
// checked; body traits reach the resident; the activity log fills as the world runs.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession, httpClient } from './helpers/server.mjs';

let s, owner, ann, adm, id;
const wait = ms => new Promise(r => setTimeout(r, ms));
before(async () => {
  s = await startServer({ population: 220, agents: 3 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  adm = await userSession(s, owner, { login: 'adm', displayName: 'Adm', role: 'admin' });
  id = (await owner.get('/api/agents')).json.agents[0].id;
});
after(async () => { await s?.stop(); });

test('only the owner (or a manage share) sees an agent\'s life; everyone else gets 404, guests 401', async () => {
  for (const p of ['profile', 'memories', 'people', 'activity']) {
    assert.equal((await owner.get(`/api/agent-life/${p}?agent=${id}`)).status, 200, p);
    assert.equal((await ann.get(`/api/agent-life/${p}?agent=${id}`)).status, 404, `${p}: a member`);
    assert.equal((await adm.get(`/api/agent-life/${p}?agent=${id}`)).status, 404, `${p}: not even an administrator`);
    assert.equal((await httpClient(s.url).get(`/api/agent-life/${p}?agent=${id}`)).status, 401, `${p}: a guest`);
  }
  assert.equal((await ann.post('/api/agent-life/profile', { agent: id, bio: 'x' })).status, 404);
  await owner.post('/api/agents/share', { id, kind: 'account', who: String(ann.id), level: 'manage' });
  assert.equal((await ann.get(`/api/agent-life/profile?agent=${id}`)).status, 200, 'a manage share may');
  await owner.post('/api/agents/unshare', { id, kind: 'account', who: String(ann.id) });
  assert.equal((await ann.get(`/api/agent-life/profile?agent=${id}`)).status, 404);
});

test('the profile is checked; body traits reach the resident', async () => {
  const set = await owner.post('/api/agent-life/profile', { agent: id, traits: { sociability: 0.9, curiosity: 0.85 }, flags: { nightOwl: true }, purpose: 'Open a bakery', aspirations: ['Save 500 VC'], likes: ['bread'], locked: ['curiosity'] });
  assert.equal(set.status, 200, set.text);
  assert.equal(set.json.profile.traits.curiosity, 0.85);
  assert.equal(set.json.profile.purpose, 'Open a bakery');
  const got = (await owner.get(`/api/agent-life/profile?agent=${id}`)).json.profile;
  assert.equal(got.traits.sociability, 0.9, 'read back from the resident');
  assert.equal(got.flags.nightOwl, true);
  assert.deepEqual(got.locked, ['curiosity']);
  for (const bad of [{ traits: { curiosity: 7 } }, { traits: { x: 0.1 } }, { flags: { nightOwl: 1 } }, { locked: ['nope'] }, { likes: 'bread' }, {}]) {
    assert.equal((await owner.post('/api/agent-life/profile', { agent: id, ...bad })).status, 400, JSON.stringify(bad));
  }
});

test('plans and memories: add, finish, promote, remove; bad input is refused', async () => {
  let r = await owner.post('/api/agent-life/plans', { agent: id, add: { kind: 'must', text: 'Pay the rent', today: true } });
  assert.equal(r.status, 200, r.text);
  const plan = r.json.plans.find(x => x.text === 'Pay the rent');
  assert.equal(plan.today, true);
  assert.equal((await owner.post('/api/agent-life/plans', { agent: id, add: { kind: 'maybe', text: 'x' } })).status, 400);
  r = await owner.post('/api/agent-life/plans', { agent: id, id: plan.id, status: 'done' });
  assert.equal(r.json.plans.find(x => x.id === plan.id).status, 'done');
  assert.equal((await owner.post('/api/agent-life/plans', { agent: id, id: 999999, status: 'done' })).status, 404);
  assert.equal((await owner.post('/api/agent-life/memories', { agent: id, add: { term: 'short', kind: 'note', text: 'Ann likes croissants', importance: 4 } })).status, 200);
  const short = (await owner.get(`/api/agent-life/memories?agent=${id}&term=short`)).json.memories;
  const m = short.find(x => x.text === 'Ann likes croissants');
  assert.ok(m && m.source === 'owner');
  assert.equal((await owner.post('/api/agent-life/memories', { agent: id, id: m.id, promote: true })).status, 200);
  assert.ok((await owner.get(`/api/agent-life/memories?agent=${id}&term=long`)).json.memories.some(x => x.id === m.id), 'promoted to long-term');
  assert.equal((await owner.post('/api/agent-life/memories', { agent: id, id: m.id, remove: true })).status, 200);
  assert.equal((await owner.post('/api/agent-life/memories', { agent: id, add: { text: 'x', importance: 9 } })).status, 400);
  assert.equal((await owner.get(`/api/agent-life/memories?agent=${id}&term=forever`)).status, 400);
  assert.equal((await owner.post('/api/agent-life/people', { agent: id, kind: 'resident', id: 'nobody', note: 'hi' })).status, 404, 'a note only for someone it knows');
});

test('the activity log fills as the world runs', async () => {
  await owner.post('/api/clock', { rate: 30 });
  let rows = [];
  for (let k = 0; k < 30 && rows.length < 3; k++) { await wait(1000); rows = (await owner.get(`/api/agent-life/activity?agent=${id}`)).json.activity; }
  await owner.post('/api/clock', { rate: 1 });
  assert.ok(rows.length >= 3, `activity lines (${rows.length})`);
  assert.ok(rows.every(r => r.label && r.when));
  assert.ok(rows[0].now === true || rows[0].id, 'the line in progress first');
});
