// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What the Agent Studio needs from the server (client/js/ui/agent-studio.js): who an agent is linked to (its brain) for
// those who manage it and nobody else; which model a brain thinks with for everyone who may use it, its other settings
// for its managers only; a rename in the Studio reaching the agent's body in the city; and an agent's owner (or a manage
// share) dressing its body - its look only, nobody else's, nothing more - and undoing that.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann, bob, agents;
before(async () => {
  s = await startServer({ population: 220, agents: 3, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  bob = await userSession(s, owner, { login: 'bob', displayName: 'Bob', role: 'member' });
  agents = (await owner.get('/api/agents')).json.agents;
});
after(async () => { await s?.stop(); });

test('managers see what an agent is linked to; users and strangers do not; a brain\'s model is shown to its users only', async () => {
  const a = agents[0];
  const c = await owner.post('/api/connections', { kind: 'models', label: 'House brain', scope: 'installation', config: { provider: 'custom', baseUrl: 'http://127.0.0.1:9/v1', model: 'fake/model-1', priceInPerMTok: 0.5 }, secrets: { apiKey: 'sk-HIDDEN-1' } });
  assert.equal(c.status, 200, c.text);
  assert.equal((await owner.post('/api/agents/update', { id: a.id, connectionId: c.json.id })).status, 200);
  const mine = (await owner.get('/api/agents')).json.agents.find(x => x.id === a.id);
  assert.deepEqual(mine.connection, { id: c.json.id, label: 'House brain', kind: 'models', enabled: true });
  // a "use" share: the agent is listed, its link is not
  assert.equal((await owner.post('/api/agents/share', { id: a.id, kind: 'account', who: String(ann.id), level: 'use' })).status, 200);
  const asAnn = (await ann.get('/api/agents')).json.agents.find(x => x.id === a.id);
  assert.equal(asAnn.level, 'use');
  assert.equal('connection' in asAnn, false);
  assert.equal('connection' in (await bob.get('/api/agents')).json.agents.find(x => x.id === a.id), false);
  // the brain shared with members: its model for them, not its address, prices or key
  assert.equal((await owner.post('/api/connections/share', { id: c.json.id, kind: 'role', who: 'member' })).status, 200);
  const seen = (await ann.get('/api/connections')).json.connections.find(x => x.id === c.json.id);
  assert.deepEqual(seen.brain, { provider: 'custom', model: 'fake/model-1', thinking: 'off' });
  assert.equal(seen.config, undefined);
  assert.equal(seen.secrets, undefined);
  assert.ok(!JSON.stringify(seen).includes('127.0.0.1') && !JSON.stringify(seen).includes('HIDDEN'));
  // a manager may change the model: everyone using it sees the new one
  assert.equal((await owner.post('/api/connections/update', { id: c.json.id, config: { model: 'fake/model-2' } })).status, 200);
  assert.equal((await ann.get('/api/connections')).json.connections.find(x => x.id === c.json.id).brain.model, 'fake/model-2');
  assert.equal((await ann.post('/api/connections/update', { id: c.json.id, config: { model: 'x' } })).status, 403);
  assert.equal((await owner.post('/api/agents/unshare', { id: a.id, kind: 'account', who: String(ann.id) })).status, 200);
});

test('renaming an agent in the Studio renames its body in the city, with its badge and role', async () => {
  const a = agents[1];
  const r = await owner.post('/api/agents/update', { id: a.id, name: 'Nova Studio', emoji: '🚀', role: 'Explorer' });
  assert.equal(r.status, 200, r.text);
  const info = (await owner.get(`/api/agent/${a.i}`)).json;
  assert.equal(info.name, 'Nova Studio');
  assert.equal(info.emoji, '🚀');
  assert.equal(info.role, 'Explorer');
  assert.equal(r.json.name, 'Nova Studio');
  // only what was sent changes
  assert.equal((await owner.post('/api/agents/update', { id: a.id, role: 'Pathfinder' })).status, 200);
  const again = (await owner.get(`/api/agent/${a.i}`)).json;
  assert.equal(again.name, 'Nova Studio'); assert.equal(again.role, 'Pathfinder'); assert.equal(again.emoji, '🚀');
});

test('an agent\'s owner dresses its body - its look only, its own agents only - and may undo it', async () => {
  const a = agents[2];
  const look = (await owner.get(`/api/agent/${a.i}`)).json.app;
  assert.ok(look, 'the body has a look');
  const other = { ...look, char: look.char === 'f01' ? 'f02' : 'f01', body: 1 };
  // Ann may not, until she manages it
  const no = await ann.post('/api/edit', { ops: [{ op: 'person.set', i: a.i, app: other }] });
  assert.equal(no.status, 403, no.text);
  assert.equal((await owner.post('/api/agents/share', { id: a.id, kind: 'account', who: String(ann.id), level: 'use' })).status, 200);
  assert.equal((await ann.post('/api/edit', { ops: [{ op: 'person.set', i: a.i, app: other }] })).status, 403, 'a use share does not dress it');
  assert.equal((await owner.post('/api/agents/share', { id: a.id, kind: 'account', who: String(ann.id), level: 'manage' })).status, 200);
  const yes = await ann.post('/api/edit', { ops: [{ op: 'person.set', i: a.i, app: other }] });
  assert.equal(yes.status, 200, yes.text);
  assert.equal((await owner.get(`/api/agent/${a.i}`)).json.app.char, other.char);
  // its look, nothing more: not its name, not its home, not another resident, not in the same request
  const before = (await owner.get(`/api/agent/${a.i}`)).json.name;
  assert.equal((await ann.post('/api/edit', { ops: [{ op: 'person.set', i: a.i, name: 'Renamed' }] })).status, 403);
  assert.equal((await ann.post('/api/edit', { ops: [{ op: 'person.set', i: a.i, app: other, name: 'Renamed' }] })).status, 403);
  assert.equal((await ann.post('/api/edit', { ops: [{ op: 'person.set', i: a.i, home: 'auto' }] })).status, 403);
  const plain = (await owner.get('/api/agents')).json.agents.map(x => x.i);
  const resident = [...Array(50).keys()].find(i => !plain.includes(i));
  assert.equal((await ann.post('/api/edit', { ops: [{ op: 'person.set', i: resident, app: other }] })).status, 403, 'not an ordinary resident');
  assert.equal((await bob.post('/api/edit', { ops: [{ op: 'person.set', i: a.i, app: look }] })).status, 403, 'not a stranger');
  assert.equal((await owner.get(`/api/agent/${a.i}`)).json.name, before);
  // and undo puts its look back
  const u = await ann.post('/api/undo', {});
  assert.equal(u.status, 200, u.text);
  assert.equal((await owner.get(`/api/agent/${a.i}`)).json.app.char, look.char);
});
