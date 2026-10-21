// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Taking over someone else's connected agent, over HTTP on a real server (server/agent-api.js, routes.js; 2026-10-11): a code
// someone else saw (a screenshot, a shared chat, a log) is worth nothing without its owner's OK - the key it enrols waits, opens
// no session, puts nothing in the world, and its owner is told at once with the key to compare; the owner declines it and that key
// is dead. Only the owner answers for the connection: not a stranger, not the installation's owner, not a person it is shared
// with to manage. A disconnected key and a replayed login stay refused. The admin's switch turns the wait off for an
// installation that wants the old behaviour. The refusal limit counts per address, so this file keeps to a few refusals.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann, ben;
const S = {};
const makeAgent = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64url');
  return { pub, sign: m => crypto.sign(null, Buffer.from(m), privateKey).toString('base64url') };
};
const nonce = () => crypto.randomBytes(12).toString('base64url');
async function call(method, p, body, token = null) {
  const h = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) };
  const r = await fetch(new URL(p, s.url), { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text };
}
const enrol = (a, code) => call('POST', '/api/agent-api/enroll', { code, publicKey: a.pub, signature: a.sign(`v1|enrol|${code}|${a.pub}`) });
const sessionBody = (a, slot, ts = Math.floor(Date.now() / 1000), n = nonce()) => ({ slot, timestamp: ts, nonce: n, signature: a.sign(`v1|session|${slot}|${ts}|${n}`) });
const login = (a, slot) => call('POST', '/api/agent-api/session', sessionBody(a, slot));
const slotOf = async (c, id) => (await c.get('/api/agent-slots')).json.agents.find(a => a.id === id) || null;
const recordOf = async (c, id) => (await c.get('/api/agents')).json.agents.find(a => a.key === `ext-${id}`) || null;
const notes = async c => { const j = (await c.get('/api/notifications')).json; return j.notifications || j.items || j.list || []; };

before(async () => {
  s = await startServer({ population: 120, agents: 2 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  ben = await userSession(s, owner, { login: 'ben', displayName: 'Ben', role: 'member' });
  S.ben = String((await ben.get('/api/auth/me')).json.account.id);
});
after(async () => { await s?.stop(); });

test('a stolen code: the thief\'s key waits, signs in to nothing, shows nothing in the world, and its owner is told with the key to compare', async () => {
  const made = await ann.post('/api/agent-slots', { name: 'Juno' });
  S.slot = made.json.slot.id; S.code = made.json.code;
  await ann.post('/api/agent-slots/update', { id: S.slot, visibility: 'public', chatAudience: 'everyone', appearInWorld: true });
  S.thief = makeAgent();
  const en = await enrol(S.thief, S.code);
  assert.equal(en.status, 200, en.text); assert.equal(en.json.approval, 'waiting'); assert.match(en.json.note || '', /owner/i);
  const fp = en.json.fingerprint.slice(0, 16);
  const tries = await login(S.thief, S.slot);
  assert.equal(tries.status, 403, tries.text); assert.equal(tries.json.code, 'awaiting_approval'); assert.equal(tries.json.token, undefined);
  assert.equal((await login(S.thief, S.slot)).status, 403, 'asking again changes nothing');
  assert.equal((await call('GET', '/api/agent-api/me')).status, 401, 'no token, nothing');
  const v = await slotOf(ann, S.slot);
  assert.equal(v.approval, 'waiting'); assert.equal(v.fingerprint.slice(0, 16), fp, 'the owner sees the same key the AI was told');
  assert.equal((await recordOf(ann, S.slot))?.enabled ?? false, false, 'not on in the world');
  assert.equal(await recordOf(ben, S.slot), null, 'public, yet nobody else sees it: it is not on');
  const told = (await notes(ann)).find(n => /waiting for your OK/.test(n.body || ''));
  assert.ok(told, 'its owner is told at once'); assert.ok(told.body.includes(fp), 'with the key to compare');
  assert.equal((await enrol(makeAgent(), S.code)).status, 401, 'the code worked once: nobody else (not even the owner\'s own AI) enrols with it');
});

test('only its owner answers: not a stranger, not the installation\'s owner; the owner declines and the thief\'s key is dead', async () => {
  for (const [who, c] of [['a stranger', ben], ['the installation owner', owner]]) {
    for (const p of ['/api/agent-slots/approve', '/api/agent-slots/decline']) assert.equal((await c.post(p, { id: S.slot })).status, 404, `${who}: ${p}`);
  }
  const no = await ann.post('/api/agent-slots/decline', { id: S.slot });
  assert.equal(no.status, 200, no.text); assert.equal(no.json.agent.status, 'pending'); assert.equal(no.json.agent.fingerprint, null);
  assert.equal((await login(S.thief, S.slot)).status, 401, 'the thief\'s key is forgotten');
  assert.equal((await ann.post('/api/agent-slots/approve', { id: S.slot })).status, 409, 'nothing left to approve');
  // the owner's own AI, with a fresh code
  const fresh = await ann.post('/api/agent-slots/code', { id: S.slot });
  S.mine = makeAgent();
  assert.equal((await enrol(S.mine, fresh.json.code)).json.approval, 'waiting');
  const ok = await ann.post('/api/agent-slots/approve', { id: S.slot });
  assert.equal(ok.status, 200, ok.text); assert.equal(ok.json.agent.approval, 'approved');
  const ses = await login(S.mine, S.slot);
  assert.equal(ses.status, 200, ses.text); S.token = ses.json.token;
  assert.equal((await call('GET', '/api/agent-api/me', undefined, S.token)).json.agent.id, S.slot);
  assert.ok(await recordOf(ben, S.slot), 'on now: public, so others see it');
  assert.ok((await notes(ann)).some(n => /is connected/.test(n.body || '') && n.body.includes(ok.json.agent.fingerprint.slice(0, 16))), 'its owner is told it is connected, with the key');
  assert.equal((await ann.post('/api/agent-slots/decline', { id: S.slot })).status, 409, 'an approved key is disconnected, not declined');
});

test('a person it is shared with to manage runs its life, never its connection', async () => {
  const rec = await recordOf(ann, S.slot);
  assert.equal((await ann.post('/api/agents/share', { id: rec.id, kind: 'account', who: S.ben, level: 'manage' })).status, 200);
  assert.equal((await recordOf(ben, S.slot)).level, 'manage');
  assert.equal(await slotOf(ben, S.slot), null, 'its slot is not in Ben\'s list');
  for (const [p, b] of [['/api/agent-slots/approve', {}], ['/api/agent-slots/decline', {}], ['/api/agent-slots/code', {}], ['/api/agent-slots/revoke', {}], ['/api/agent-slots/update', { visibility: 'hidden' }]]) {
    assert.equal((await ben.post(p, { id: S.slot, ...b })).status, 404, p);
  }
  for (const patch of [{ enabled: false }, { name: 'Mine Now' }, { connectionId: null }]) {
    assert.equal((await ben.post('/api/agents/update', { id: rec.id, ...patch })).status, 400, JSON.stringify(patch));
  }
  assert.equal((await slotOf(ann, S.slot)).status, 'active', 'nothing changed');
  assert.equal((await call('GET', '/api/agent-api/me', undefined, S.token)).status, 200, 'its session goes on');
});

test('a replayed login and a login signed for another agent are refused; after Disconnect the key and its token are dead', async () => {
  const body = sessionBody(S.mine, S.slot);
  assert.equal((await call('POST', '/api/agent-api/session', body)).status, 200);
  assert.equal((await call('POST', '/api/agent-api/session', body)).status, 401, 'the same signed login again');
  const other = await ben.post('/api/agent-slots', { name: 'Kai' });
  assert.equal((await call('POST', '/api/agent-api/session', { ...sessionBody(S.mine, S.slot), slot: other.json.slot.id })).status, 401, 'a signature for Juno does not open Kai');
  assert.equal((await ann.post('/api/agent-slots/revoke', { id: S.slot })).status, 200);
  assert.equal((await call('GET', '/api/agent-api/me', undefined, S.token)).status, 401, 'its token ended at once');
  assert.equal((await login(S.mine, S.slot)).status, 401, 'and its key opens nothing');
  assert.ok((await notes(ann)).some(n => /was disconnected/.test(n.body || '')), 'its owner is told it was disconnected');
});

test('the admin\'s switch: with the wait off, a new key is approved at once; back on, it waits again', async () => {
  const set = v => owner.post('/api/settings', { values: { 'connected.requireApproval': v } });
  assert.equal((await ann.post('/api/settings', { values: { 'connected.requireApproval': false } })).status, 403, 'a member cannot turn it off');
  assert.equal((await set(false)).status, 200);
  try {
    const made = await ann.post('/api/agent-slots', { name: 'Open' }), a = makeAgent();
    assert.equal((await enrol(a, made.json.code)).json.approval, 'approved');
    assert.equal((await login(a, made.json.slot.id)).status, 200);
  } finally { assert.equal((await set(true)).status, 200); }
  const made = await ann.post('/api/agent-slots', { name: 'Closed' }), a = makeAgent();
  assert.equal((await enrol(a, made.json.code)).json.approval, 'waiting');
  assert.equal((await login(a, made.json.slot.id)).status, 403);
});
