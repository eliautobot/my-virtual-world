// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A connected agent in the agent list, over HTTP on a real server (PLAN WP2.14; DECISIONS E22, E23, C127; CHECKLIST I8.14, I8.15):
// it appears as an agent with its own record once enrolled, follows its slot (name, revoke, enrol again), shows offline until it has a
// session, is never counted by the demo limit, and stays hidden from everybody its owner has not let see it: guests, strangers and
// friends alike, in the agent list, in presence and by id.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann, ben, cy;
const S = {};
const makeAgent = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64url');
  return { pub, sign: m => crypto.sign(null, Buffer.from(m), privateKey).toString('base64url') };
};
const nonce = () => crypto.randomBytes(12).toString('base64url');
async function raw(method, p, body) {
  const r = await fetch(new URL(p, s.url), { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text };
}
/** Enrols with the code; its owner (ann) then approves it, unless told not to. */
const enrol = async (a, code, { approve = true } = {}) => {
  const r = await raw('POST', '/api/agent-api/enroll', { code, publicKey: a.pub, signature: a.sign(`v1|enrol|${code}|${a.pub}`) });
  if (approve && r.status === 200) assert.equal((await ann.post('/api/agent-slots/approve', { id: r.json.slot.id })).status, 200);
  return r;
};
const login = async (a, slot) => { const ts = Math.floor(Date.now() / 1000), n = nonce(); return raw('POST', '/api/agent-api/session', { slot, timestamp: ts, nonce: n, signature: a.sign(`v1|session|${slot}|${ts}|${n}`) }); };
const KEY = () => `ext-${S.slot}`;
const listed = async who => ((who ? await who.get('/api/agents') : await raw('GET', '/api/agents')).json.agents || []).map(a => a.key);
const presenceKeys = async who => ((who ? await who.get('/api/presence') : await raw('GET', '/api/presence')).json.agents || []).map(a => a.key);
const byId = async (who, id) => (who ? who.get(`/api/presence/${id}`) : raw('GET', `/api/presence/${id}`));
const agentRecord = async () => (await ann.get('/api/agents')).json.agents.find(a => a.key === KEY());

before(async () => {
  s = await startServer({ population: 150, agents: 3 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  ben = await userSession(s, owner, { login: 'ben', displayName: 'Ben', role: 'member' });
  cy = await userSession(s, owner, { login: 'cy', displayName: 'Cy', role: 'member' });
  assert.equal((await ann.post('/api/friends/request', { name: 'Ben' })).status, 200);
  const inc = (await ben.get('/api/friends')).json.incoming;
  assert.equal((await ben.post('/api/friends/accept', { id: inc[0].id })).json.state, 'friends');
});
after(async () => { await s?.stop(); });

test('a slot that is not enrolled has no agent record; enrolling makes one for its owner, offline until it has a session (I8.14)', async () => {
  const made = await ann.post('/api/agent-slots', { name: 'Claude Code' });
  S.slot = made.json.slot.id; S.a = makeAgent();
  assert.equal((await listed(ann)).includes(KEY()), false, 'nothing yet');
  assert.equal((await enrol(S.a, made.json.code, { approve: false })).status, 200);
  assert.equal((await agentRecord())?.enabled ?? false, false, 'waiting for its owner\'s OK: not on yet');
  assert.equal((await ann.post('/api/agent-slots/approve', { id: S.slot })).status, 200);
  const rec = await agentRecord();
  assert.ok(rec, 'the owner sees the agent'); assert.equal(rec.name, 'Claude Code'); assert.equal(rec.level, 'manage', 'its owner manages it in its Agent Studio (2026-10-11)'); assert.equal(rec.mine, true);
  S.id = rec.id;
  const p = (await byId(ann, S.id)).json;
  assert.deepEqual([p.state, p.working], ['offline', false], 'offline: nobody has signed in as it');
  const ses = await login(S.a, S.slot); assert.equal(ses.status, 200, ses.text);
  const q = (await byId(ann, S.id)).json;
  assert.deepEqual([q.state, q.working], ['idle', false], 'idle once its session is open');
});

test('hidden is the default: only the owner sees the agent, in the list, in presence and by id; nobody else is even told it exists (I8.15)', async () => {
  for (const [name, who] of [['a guest', null], ['a stranger', cy], ['a friend', ben]]) {
    assert.equal((await listed(who)).includes(KEY()), false, `${name}: not in the agent list`);
    assert.equal((await presenceKeys(who)).includes(KEY()), false, `${name}: not in presence`);
    assert.equal((await byId(who, S.id)).status, 404, `${name}: not by id`);
  }
  assert.equal((await listed(owner)).includes(KEY()), false, 'not even the installation owner');
  assert.ok((await listed(ann)).includes(KEY())); assert.ok((await presenceKeys(ann)).includes(KEY())); assert.equal((await byId(ann, S.id)).status, 200);
  const usable = k => ann.get('/api/agents/usable').then(r => r.json.agents.map(a => a.key).includes(k));
  assert.equal(await usable(KEY()), true, 'the owner can pick it in the chat');
  assert.equal((await ben.get('/api/agents/usable')).json.agents.some(a => a.key === KEY()), false);
});

test('friends only, then public: the owner\'s choice decides who sees it, and hiding it again takes it away at once', async () => {
  assert.equal((await ann.post('/api/agent-slots/update', { id: S.slot, visibility: 'friends' })).status, 200);
  assert.equal((await listed(ben)).includes(KEY()), true, 'a friend sees it'); assert.equal((await byId(ben, S.id)).status, 200);
  assert.equal((await listed(cy)).includes(KEY()), false); assert.equal((await listed(null)).includes(KEY()), false); assert.equal((await byId(cy, S.id)).status, 404);
  assert.equal((await ann.post('/api/agent-slots/update', { id: S.slot, visibility: 'public' })).status, 200);
  for (const who of [cy, null, ben, owner]) assert.equal((await listed(who)).includes(KEY()), true);
  assert.equal((await byId(null, S.id)).status, 200, 'a guest may look');
  const seenByOthers = (await byId(cy, S.id)).json;
  assert.equal('task' in seenByOthers, false, 'and sees whether it works, not on what');
  assert.equal((await ann.post('/api/agent-slots/update', { id: S.slot, visibility: 'hidden' })).status, 200);
  for (const who of [cy, null, ben]) assert.equal((await listed(who)).includes(KEY()), false);
});

test('the slot\'s name is the agent\'s name; revoking turns the record off and enrolling again turns it on (C124)', async () => {
  assert.equal((await ann.post('/api/agent-slots/update', { id: S.slot, name: 'Ada' })).status, 200);
  assert.equal((await agentRecord()).name, 'Ada');
  assert.equal((await ann.post('/api/agent-slots/revoke', { id: S.slot })).status, 200);
  assert.equal(await agentRecord(), undefined, 'no longer listed');
  assert.equal((await byId(ann, S.id)).status, 404);
  const code = await ann.post('/api/agent-slots/code', { id: S.slot });
  const b = makeAgent();
  assert.equal((await enrol(b, code.json.code)).status, 200);
  const rec = await agentRecord();
  assert.ok(rec, 'back'); assert.equal(rec.id, S.id, 'the same record, so its history stays'); assert.equal(rec.name, 'Ada');
  assert.equal((await byId(ann, S.id)).json.state, 'offline', 'offline until the new key has a session');
  assert.equal((await login(b, S.slot)).status, 200);
  assert.equal((await byId(ann, S.id)).json.state, 'idle');
});

test('connected agents are not the installation\'s agents: the demo limit does not count them and does not hide them', async () => {
  const ordinary = (await listed(null)).filter(k => !k.startsWith('ext-'));
  assert.equal(ordinary.length, 3, 'the three demo agents are still listed for everybody');
  const mine = await listed(ann);
  assert.equal(mine.length, 4, 'and the owner\'s connected agent comes on top');
  const extra = await ann.post('/api/agent-slots', { name: 'Second' }); const c = makeAgent();
  assert.equal((await enrol(c, extra.json.code)).status, 200);
  assert.equal((await listed(ann)).length, 5); assert.equal((await listed(null)).length, 3, 'still hidden from guests');
});

test('the server-made connection cannot be added, changed or removed by hand, and a connected agent\'s name, removal and "use" sharing stay with its slot', async () => {
  const add = await ann.post('/api/connections', { kind: 'agentapi', label: 'By hand', scope: 'account', config: {}, secrets: {} });
  assert.equal(add.status, 400, add.text); assert.equal(add.json.code, 'managed_by_system');
  const mine = (await ann.get('/api/connections')).json.connections.filter(c => c.kind === 'agentapi');
  assert.ok(mine.length >= 1, 'the owner sees the connection the server made');
  for (const p of ['/api/connections/update', '/api/connections/remove']) {
    const r = await ann.post(p, { id: mine[0].id, label: 'x' });
    assert.equal(r.status, 409, `${p}: ${r.text}`); assert.equal(r.json.code, 'managed_by_system');
  }
  // (its owner manages it in its Agent Studio - its look, role, life - but its name and disconnecting it are its slot's, and
  // who may chat with it is the slot's audience: no "use" share; 2026-10-11)
  for (const [p, b, code] of [['/api/agents/update', { id: S.id, name: 'Hacked' }, 'connected_agent'], ['/api/agents/remove', { id: S.id }, 'connected_agent'], ['/api/agents/share', { id: S.id, kind: 'account', who: '3', level: 'use' }, 'connected_share']]) {
    const r = await ann.post(p, b);
    assert.equal(r.status, 400, `${p}: ${r.text}`); assert.equal(r.json.code, code); assert.match(r.json.error, /Third-party agents/);
    assert.equal((await cy.post(p, b)).status, 404, `${p}: another account is not told it exists`);
  }
  assert.equal((await agentRecord()).name, 'Ada');
});
