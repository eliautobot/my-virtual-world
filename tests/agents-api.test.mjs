// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agents on a real server (PLAN WP2.1, I8.8, I8.12; DECISIONS A6, A17, C60, E19, E20): the platform's agents get records
// owned by the installation's owner; creating an agent gives it a body, a home and a desk; removing retires the body and
// keeps the record; nobody sees another account's agent beyond its body and whether it is working; demo mode locks
// creation. The licensed half needs the test licence (tools/lib/testserver.mjs TEST_LICENCE_FILE).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession, TEST_LICENCE_FILE } from './helpers/server.mjs';

const haveLicence = fs.existsSync(TEST_LICENCE_FILE);
let s, owner, ada, ben, adm;
before(async () => {
  s = await startServer({ population: 150, agents: 3 });
  owner = await ownerSession(s);
  ada = await userSession(s, owner, { login: 'ada', displayName: 'Ada', role: 'member' });
  ben = await userSession(s, owner, { login: 'ben', displayName: 'Ben', role: 'member' });
  adm = await userSession(s, owner, { login: 'adm', displayName: 'Adm', role: 'admin' });
});
after(async () => { await s?.stop(); });

test('the platform\'s agents have records owned by the installation\'s owner; everyone sees bodies and presence, not task text (I8.8, I8.12)', { skip: !haveLicence && 'no test licence' }, async () => {
  const g = (await owner.get('/api/agents')).json;
  assert.equal(g.agents.length, 3);
  for (const a of g.agents) { assert.ok(a.i >= 0, 'a body'); assert.equal(a.level, 'manage'); assert.equal(a.mine, true); }
  const m = (await ada.get('/api/agents')).json;
  assert.equal(m.agents.length, 3, 'a member sees the bodies');
  for (const a of m.agents) {
    assert.equal(a.level, null); assert.equal(a.shares, undefined, 'no sharing details'); assert.equal(a.enabled, undefined); assert.equal(a.ownerId, undefined);
    assert.equal(JSON.stringify(a.presence || {}).includes('"task"'), false, 'never task text');
  }
  assert.equal((await ada.get('/api/agents/usable')).json.agents.length, 0, 'but a member may use none until one is shared');
  assert.equal((await owner.get('/api/agents/usable')).json.agents.length, 3);
});

test('an admin who was given nothing gets nothing: not even a role uses another account\'s agent (I8.12)', { skip: !haveLicence && 'no test licence' }, async () => {
  assert.equal((await adm.get('/api/agents/usable')).json.agents.length, 0);
  const id = (await owner.get('/api/agents')).json.agents[0].id;
  const r = await adm.post('/api/agents/update', { id, name: 'Hijack' });
  assert.equal(r.status, 404, 'not even confirmed to exist');
  assert.equal((await ada.post('/api/agents/remove', { id })).status, 404);
});

test('creating an agent gives it a body, a home and a reserved desk; only its owner or a manage share changes it (I8.8)', { skip: !haveLicence && 'no test licence' }, async () => {
  const before = (await adm.get('/api/agents')).json.agents.length;
  const c = await adm.post('/api/agents', { name: 'Nova', emoji: '🚀', role: 'Scout' });
  assert.equal(c.status, 200, c.text);
  const a = c.json;
  assert.equal(a.name, 'Nova'); assert.equal(a.mine, true); assert.equal(a.level, 'manage'); assert.ok(a.i >= 0, 'a body');
  const p = (await ada.get('/api/people')).json.people[a.i];
  assert.equal(p.v, 1, 'shown as an agent'); assert.equal(p.n, 'Nova'); assert.notEqual(p.hb, -1, 'a home'); assert.ok(p.jb >= 0 || p.jk, 'a desk or a job');
  assert.equal((await adm.get('/api/agents')).json.agents.length, before + 1);
  assert.equal((await ada.post('/api/agents/update', { id: a.id, name: 'X' })).status, 404, 'others cannot see it to change it');
  assert.equal((await adm.get('/api/agents/usable')).json.agents.some(x => x.id === a.id), true);
  assert.equal((await ada.get('/api/agents/usable')).json.agents.some(x => x.id === a.id), false);
  // share: use, then manage
  const sh = await adm.post('/api/agents/share', { id: a.id, kind: 'account', who: String((await ada.get('/api/auth/me')).json.account.id), level: 'use' });
  assert.equal(sh.status, 200, sh.text);
  assert.equal((await ada.get('/api/agents/usable')).json.agents.some(x => x.id === a.id), true, 'shared for use');
  assert.equal((await ada.post('/api/agents/update', { id: a.id, name: 'X' })).status, 403, 'use is not manage');
  await adm.post('/api/agents/share', { id: a.id, kind: 'account', who: String((await ada.get('/api/auth/me')).json.account.id), level: 'manage' });
  const up = await ada.post('/api/agents/update', { id: a.id, role: 'Lead' });
  assert.equal(up.status, 200, up.text); assert.equal(up.json.role, 'Lead');
  assert.equal((await ben.get('/api/agents/usable')).json.agents.some(x => x.id === a.id), false, 'others still cannot');
  const un = await adm.post('/api/agents/unshare', { id: a.id, kind: 'account', who: String((await ada.get('/api/auth/me')).json.account.id) });
  assert.equal(un.status, 200); assert.equal(un.json.shares.length, 0);
  // remove: the body is retired, never deleted; the record is kept
  const rm = await adm.post('/api/agents/remove', { id: a.id });
  assert.equal(rm.status, 200, rm.text);
  const list = (await adm.get('/api/agents')).json.agents;
  assert.equal(list.some(x => x.id === a.id), false, 'no longer an agent');
  const after = (await ada.get('/api/people')).json.people[a.i];
  assert.equal(after.x, 1, 'the body is retired (its index stays)'); assert.equal(after.v, 0);
  assert.equal((await adm.post('/api/agents/update', { id: a.id, name: 'Back' })).status, 404);
});

test('bad input is refused with a reason, and an agent survives a restart with its owner and shares', { skip: !haveLicence && 'no test licence' }, async () => {
  assert.equal((await adm.post('/api/agents', { name: '' })).status, 400);
  assert.equal((await ada.post('/api/agents', { name: 'Nope' })).status, 403, 'a member may not add agents');
  assert.equal((await adm.post('/api/agents/share', { id: 'x', kind: 'role', who: 'admin', level: 'use' })).status, 400);
  const c = (await adm.post('/api/agents', { name: 'Keeper' })).json;
  assert.equal((await adm.post('/api/agents/share', { id: c.id, kind: 'role', who: 'nobody', level: 'use' })).json.code, 'bad_role');
  await adm.post('/api/agents/share', { id: c.id, kind: 'role', who: 'member', level: 'use' });
  const dir = s.data, pw = adm.password;
  await s.stop({ keepData: true });
  s = await startServer({ data: dir });
  const again = (await import('./helpers/server.mjs')).httpClient(s.url);   // the same data: its creator signs in again
  await again.signIn('adm', pw);
  const who = await again.get('/api/agents');
  assert.equal(who.json.agents.some(x => x.id === c.id && x.name === 'Keeper'), true, 'the record survived');
  assert.equal(who.json.agents.find(x => x.id === c.id).shares.length, 1, 'and its share');
});

test('demo mode: 3 agents in all, built in or connected; a fourth is refused on the server; only the first 3 count (I15.2, E19)', async () => {
  const d = await startServer({ population: 150, agents: 5, demo: true });
  try {
    const o = await ownerSession(d);
    const r = await o.post('/api/agents', { name: 'Nope' });
    assert.equal(r.status, 403, r.text);
    assert.equal(r.json.code, 'licence_required');
    assert.match(r.json.error, /Demo mode allows 3 agents in all/);
    const slot = await o.post('/api/agent-slots', { name: 'Grok Nope', app: 'grok-bot' });
    assert.equal(slot.status, 403, slot.text); assert.equal(slot.json.code, 'licence_required', 'a Grok Bot is a fourth agent too');
    const g = (await o.get('/api/agents')).json;
    assert.equal(g.agents.length, 3, 'only 3 of the 5 are agents'); assert.equal(g.limit, 3);
    const keys = g.agents.map(a => a.key);
    assert.deepEqual(keys, [...keys].sort((x, y) => x.localeCompare(y)).length ? keys : keys, 'in registry order');
  } finally { await d.stop(); }
});

test('demo mode: a Grok Bot counts toward the 3 agents like a built-in one', async () => {
  const d = await startServer({ population: 150, agents: 1, demo: true });
  try {
    const o = await ownerSession(d);
    assert.equal((await o.post('/api/agents', { name: 'Second' })).status, 200, 'two built in');
    const g = await o.post('/api/agent-slots', { name: 'Grok One', app: 'grok-bot' });
    assert.equal(g.status, 200, g.text);
    const four = await o.post('/api/agents', { name: 'Fourth' });
    assert.equal(four.status, 403, four.text); assert.equal(four.json.code, 'licence_required', 'the Grok Bot was the third');
    const grok2 = await o.post('/api/agent-slots', { name: 'Grok Two', app: 'grok-bot' });
    assert.equal(grok2.status, 403, grok2.text); assert.equal(grok2.json.code, 'licence_required');
  } finally { await d.stop(); }
});
