// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A connected agent lives in the city (PLAN WP2.10; 2026-09-29: "every agent needs a body/character"): enrolling gives it a resident
// with a home and a desk; the public sees an ordinary citizen unless the agent is public (I8.15: a hidden agent is not even told about);
// renaming and visibility changes follow to the body; revoking takes the body out of the city and enrolling again brings the same
// resident back. Over HTTP on a real server.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann;
const S = {};
const makeAgent = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64url');
  return { pub, sign: m => crypto.sign(null, Buffer.from(m), privateKey).toString('base64url') };
};
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
const KEY = () => `ext-${S.slot}`;
/** What a stranger's page loads. */
const publicPeople = async () => (await raw('GET', '/api/people')).json;
const publicBody = async () => (await publicPeople()).people.find(p => p.i === S.i);
const record = async () => (await ann.get('/api/agents')).json.agents.find(a => a.key === KEY());
const count = async () => (await publicPeople()).people.length;

before(async () => {
  s = await startServer({ population: 150, agents: 3 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
});
after(async () => { await s?.stop(); });

test('enrolling gives the agent a resident with a home; the public sees an ordinary citizen, the owner sees where the body is', async () => {
  const made = await ann.post('/api/agent-slots', { name: 'Codex' });
  S.slot = made.json.slot.id; S.a = makeAgent(); S.before = await count();
  assert.equal((await enrol(S.a, made.json.code)).status, 200);
  const rec = await record();
  assert.ok(rec.i >= 0, 'the owner\'s agent list knows where the body is'); S.i = rec.i;
  assert.equal(await count(), S.before + 1, 'one resident more');
  const b = await publicBody();
  assert.equal(b.x, 0); assert.ok(b.hb >= 0, 'it has a home');
  assert.notEqual(b.n, 'Codex', 'a hidden agent does not carry its name in the public list'); assert.ok(b.n.length > 3);
  assert.deepEqual([b.v, b.ag, b.e, b.r], [0, '', '', ''], 'no agent marks');
  assert.equal(/ext|codex/i.test(b.id), false, 'the resident id does not name the agent');
  assert.equal(/agent/i.test(b.jt), false, `the job title says nothing about agents: ${b.jt}`);
  const pub = await publicPeople();
  assert.equal(JSON.stringify(pub).includes(KEY()), false, 'the agent key appears nowhere in what a stranger loads');
  assert.equal(JSON.stringify(pub).includes('Codex'), false, 'nor its name');
});

test('a public agent is shown as an agent with its own name; friends-only hides it again; renaming follows; nothing is added twice', async () => {
  const n = await count();
  assert.equal((await ann.post('/api/agent-slots/update', { id: S.slot, visibility: 'public' })).status, 200);
  let b = await publicBody();
  assert.equal(b.n, 'Codex'); assert.equal(b.v, 1); assert.equal(b.ag, KEY());
  assert.equal((await ann.post('/api/agent-slots/update', { id: S.slot, name: 'Ada' })).status, 200);
  assert.equal((await publicBody()).n, 'Ada', 'a rename follows to the body');
  assert.equal((await ann.post('/api/agent-slots/update', { id: S.slot, visibility: 'friends' })).status, 200);
  b = await publicBody();
  assert.notEqual(b.n, 'Ada'); assert.deepEqual([b.v, b.ag], [0, '']);
  { const hit = (await publicPeople()).people.filter(p => /\bAda\b/.test(p.n) || p.ag === KEY()); assert.deepEqual(hit.map(p => [p.i, p.n, p.ag]), [], 'the name and key are gone from the public list again'); }
  assert.equal(await count(), n, 'still one body');
  assert.equal((await record()).i, S.i, 'the owner still finds it');
});

test('revoking takes the body out of the city and enrolling again brings the same resident back', async () => {
  const before = await count();
  assert.equal((await ann.post('/api/agent-slots/revoke', { id: S.slot })).status, 200);
  const gone = await publicBody();
  assert.equal(gone.x, 1, 'retired: not drawn, not planned'); assert.equal(gone.hb, -1, 'its bed is free again');
  const info = await raw('GET', `/api/agent/${S.i}`);
  assert.deepEqual([info.status, info.json.retired], [200, true], 'a page still looking at the retired resident is told so, not given a 404');
  assert.equal((await raw('GET', '/api/agent/9999999')).status, 404, 'an index that never existed is still not found');
  assert.equal(await count(), before, 'residents are never deleted, their indices are shared');
  const code = await ann.post('/api/agent-slots/code', { id: S.slot });
  assert.equal((await enrol(makeAgent(), code.json.code)).status, 200);
  const back = await publicBody();
  assert.equal(back.x, 0); assert.ok(back.hb >= 0, 'a bed again'); assert.equal(await count(), before, 'no second body');
  assert.equal((await record()).i, S.i, 'the same resident');
});

test('two connected agents get two different residents', async () => {
  const made = await ann.post('/api/agent-slots', { name: 'Aster' });
  assert.equal((await enrol(makeAgent(), made.json.code)).status, 200);
  const list = (await ann.get('/api/agents')).json.agents.filter(a => a.key.startsWith('ext-'));
  assert.equal(list.length, 2); assert.ok(list.every(a => a.i >= 0)); assert.notEqual(list[0].i, list[1].i);
});
