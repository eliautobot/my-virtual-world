// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A connected agent (an outside AI) in its owner's Agent Studio (server/agents.js level, routes.js; 2026-10-11): its owner
// manages it like any agent - its look, role, badge, life, friends, money - and so does a person it is shared with to manage;
// its name, whether it is on, what it thinks with and disconnecting it stay with its slot (Settings → Third-party agents);
// it is shared only to manage, with a person (who may chat with it is the slot's audience); strangers get nothing.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann, ben, cy;
const S = {};
before(async () => {
  s = await startServer({ population: 120, agents: 2 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  ben = await userSession(s, owner, { login: 'ben', displayName: 'Ben', role: 'member' });
  cy = await userSession(s, owner, { login: 'cy', displayName: 'Cy', role: 'member' });
  const made = await ann.post('/api/agent-slots', { name: 'Grok Resident' });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64url');
  const sig = crypto.sign(null, Buffer.from(`v1|enrol|${made.json.code}|${pub}`), privateKey).toString('base64url');
  const r = await fetch(new URL('/api/agent-api/enroll', s.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: made.json.code, publicKey: pub, signature: sig }) });
  assert.equal(r.status, 200);
  assert.equal((await ann.post('/api/agent-slots/approve', { id: made.json.slot.id })).status, 200, 'its owner\'s OK');
  S.rec = (await ann.get('/api/agents')).json.agents.find(a => a.key === `ext-${made.json.slot.id}`);
  S.ben = String((await ben.get('/api/auth/me')).json.account.id);
});
after(async () => { await s?.stop(); });
const levelOf = async c => (await c.get('/api/agents')).json.agents.find(a => a.id === S.rec.id)?.level ?? null;

test('its owner manages it: the Studio\'s level, its role and badge - its name, on/off and brain stay with its slot', async () => {
  assert.equal(await levelOf(ann), 'manage');
  const ok = await ann.post('/api/agents/update', { id: S.rec.id, role: 'Explorer', emoji: '🚀' });
  assert.equal(ok.status, 200, ok.text); assert.equal(ok.json.role, 'Explorer');
  for (const patch of [{ name: 'Someone Else' }, { enabled: false }, { connectionId: null }, { nativeId: 'x' }]) {
    const r = await ann.post('/api/agents/update', { id: S.rec.id, ...patch });
    assert.equal(r.status, 400, JSON.stringify(patch)); assert.equal(r.json.code, 'connected_agent');
    assert.match(r.json.error, /Third-party agents/);
  }
  const rm = await ann.post('/api/agents/remove', { id: S.rec.id });
  assert.equal(rm.status, 400); assert.equal(rm.json.code, 'connected_agent');
});

test('shared only to manage, with a person: that person manages it; a role or a "use" share is refused; a stranger gets nothing', async () => {
  for (const sh of [{ kind: 'account', who: S.ben, level: 'use' }, { kind: 'role', who: 'member', level: 'use' }]) {
    const r = await ann.post('/api/agents/share', { id: S.rec.id, ...sh });
    assert.equal(r.status, 400, JSON.stringify(sh)); assert.match(r.json.error, /only to manage, with a person/);
  }
  assert.equal(await levelOf(ben), null, 'before: Ben has nothing');
  assert.equal((await ann.post('/api/agents/share', { id: S.rec.id, kind: 'account', who: S.ben, level: 'manage' })).status, 200);
  assert.equal(await levelOf(ben), 'manage');
  assert.equal((await ben.post('/api/agents/update', { id: S.rec.id, role: 'Guide' })).status, 200, 'Ben changes its role');
  assert.equal((await ben.post('/api/agents/share', { id: S.rec.id, kind: 'account', who: S.ben, level: 'manage' })).status, 403, 'only its owner shares it');
  assert.equal(await levelOf(cy), null, 'Cy, a stranger, has nothing');
  assert.equal((await cy.post('/api/agents/update', { id: S.rec.id, role: 'Nope' })).status, 404);
  assert.equal((await ann.post('/api/agents/unshare', { id: S.rec.id, kind: 'account', who: S.ben })).status, 200);
  assert.equal(await levelOf(ben), null, 'unshared: Ben has nothing again');
});
