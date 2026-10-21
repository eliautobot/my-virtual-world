// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Free Will on a real server (docs/features/FREE-WILL.md §2, §7, §9): an administrator sets up the installation's decision
// service, an owner switches Free Will on for an agent, the agent's choices come through the provider helper (the mock
// decision service) and land in its why-log; who may see and change what; credentials never leave the server; the
// installation switch stops it.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession, httpClient } from './helpers/server.mjs';

const SECRET = 'sk-FW-TOPSECRET-7781';
let s, owner, ann, adm, conn, agentId;
const wait = ms => new Promise(r => setTimeout(r, ms));

before(async () => {
  s = await startServer({ population: 220, agents: 4, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  adm = await userSession(s, owner, { login: 'adm', displayName: 'Adm', role: 'admin' });
});
after(async () => { await s?.stop(); });

test('an administrator sets up the installation\'s decision service; its key is sealed and never comes back', async () => {
  const c = await owner.post('/api/connections', { kind: 'decisions-mock', label: 'Mock decisions', scope: 'installation', config: { latencyMs: 40 }, secrets: { apiKey: SECRET } });
  assert.equal(c.status, 200, c.text);
  conn = c.json.id;
  assert.equal((await owner.post('/api/connections/share', { id: conn, kind: 'role', who: 'member' })).status, 200);
  assert.equal((await owner.post('/api/connections/test', { id: conn })).json.ok, true);
  assert.equal((await owner.post('/api/settings', { values: { 'freeWill.defaultConnection': 'abc' } })).status, 400, 'not a connection id');
  assert.equal((await ann.post('/api/settings', { values: { 'freeWill.defaultConnection': String(conn) } })).status, 403, 'members cannot');
  const set = await owner.post('/api/settings', { values: { 'freeWill.defaultConnection': String(conn) } });
  assert.equal(set.status, 200, set.text);
  const ov = await owner.get('/api/free-will/overview');
  assert.equal(ov.status, 200);
  assert.equal(ov.json.defaultConnection, conn);
  assert.ok(ov.json.services.some(x => x.id === conn && x.implemented));
  assert.equal((await adm.get('/api/free-will/overview')).status, 200, 'administrators see the overview');
  assert.equal((await ann.get('/api/free-will/overview')).status, 403);
  assert.equal(JSON.stringify(ov.json).includes('TOPSECRET'), false);
});

test('a decision service cannot become an agent\'s chat brain', async () => {
  const list = (await owner.get('/api/agents')).json.agents;
  assert.ok(list.length >= 1);
  agentId = list[0].id;
  const r = await owner.post('/api/agents/update', { id: agentId, connectionId: conn });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.code, 'not_a_chat_provider');
});

test('only the owner (or a manage share) sees and changes an agent\'s Free Will; everyone else gets 404', async () => {
  assert.equal((await ann.get(`/api/free-will/agent?agent=${agentId}`)).status, 404);
  assert.equal((await ann.post('/api/free-will/agent', { agent: agentId, enabled: true })).status, 404);
  assert.equal((await adm.get(`/api/free-will/agent?agent=${agentId}`)).status, 404, 'not even an administrator');
  assert.equal((await httpClient(s.url).get(`/api/free-will/agent?agent=${agentId}`)).status, 401);
  const v = await owner.get(`/api/free-will/agent?agent=${agentId}`);
  assert.equal(v.status, 200, v.text);
  assert.equal(v.json.settings.enabled, false);
  assert.equal(v.json.status.reason, 'switched_off');
  assert.ok(v.json.services.some(x => x.id === conn && x.isDefault));
  for (const bad of [{ enabled: 'yes' }, { spontaneity: 3 }, { connectionId: 'x' }, {}]) {
    assert.equal((await owner.post('/api/free-will/agent', { agent: agentId, ...bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await owner.post('/api/free-will/agent', { agent: agentId, connectionId: 999999 })).status, 404);
  assert.equal((await owner.post('/api/agents/share', { id: agentId, kind: 'account', who: String(ann.id), level: 'manage' })).status, 200);
  const shared = await ann.get(`/api/free-will/agent?agent=${agentId}`);
  assert.equal(shared.status, 200, 'a manage share may');
  await owner.post('/api/agents/unshare', { id: agentId, kind: 'account', who: String(ann.id) });
  assert.equal((await ann.get(`/api/free-will/agent?agent=${agentId}`)).status, 404, 'and no longer once unshared');
});

test('switched on, the agent chooses for itself through the provider helper, and its why-log fills', async () => {
  const on = await owner.post('/api/free-will/agent', { agent: agentId, enabled: true, spontaneity: 0.6 });
  assert.equal(on.status, 200, on.text);
  assert.equal(on.json.status.active, true, JSON.stringify(on.json.status));
  // switch every test agent on, then run the clock fast through an afternoon of free time
  for (const a of (await owner.get('/api/agents')).json.agents) await owner.post('/api/free-will/agent', { agent: a.id, enabled: true });
  assert.equal((await owner.post('/api/clock', { skip: 18.5 })).status, 200);
  assert.equal((await owner.post('/api/clock', { rate: 20 })).status, 200);
  let rows = [];
  const until = Date.now() + 90000;
  while (Date.now() < until) {
    await wait(2000);
    rows = [];
    for (const a of (await owner.get('/api/agents')).json.agents) rows.push(...(await owner.get(`/api/free-will/decisions?agent=${a.id}&limit=100`)).json.decisions);
    if (rows.filter(r => r.outcome === 'chosen').length >= 3) break;
  }
  await owner.post('/api/clock', { rate: 1 });
  const chosen = rows.filter(r => r.outcome === 'chosen');
  assert.ok(chosen.length >= 3, `choices were made (${JSON.stringify(rows.map(r => [r.outcome, r.reason]))})`);
  for (const r of chosen) {
    assert.ok(r.options.some(o => o.id === r.chosen), 'one of the options offered');
    assert.ok(r.inputTokens > 0 && r.costMicro >= 0 && r.latencyMs >= 40, 'metered and timed (the mock waits 40 ms)');
  }
  const v = await owner.get(`/api/free-will/agent?agent=${agentId}`);
  assert.ok(v.json.today.requests >= 1);
  const ov = (await owner.get('/api/free-will/overview')).json;
  assert.ok(ov.counts.answered >= 3 && ov.today.requests >= 3 && ov.activeAgents >= 1);
  assert.equal(s.log().includes('TOPSECRET'), false, 'the key never reaches the log');
});

test('the installation switch stops Free Will for every agent within seconds', async () => {
  assert.equal((await owner.post('/api/settings', { values: { 'freeWill.enabled': false } })).status, 200);
  let st;
  for (let k = 0; k < 20; k++) { await wait(500); st = (await owner.get(`/api/free-will/agent?agent=${agentId}`)).json.status; if (!st.active) break; }
  assert.equal(st.active, false);
  assert.equal(st.reason, 'off');
  assert.equal((await owner.get('/api/free-will/overview')).json.activeAgents, 0);
  assert.equal((await owner.post('/api/settings', { values: { 'freeWill.enabled': true } })).status, 200);
});
