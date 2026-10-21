// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agents that connect outbound, over HTTP on a real server (PLAN WP2.14; DECISIONS E22, E23, C122 to C130; CHECKLIST I8.14):
// two accounts and two agents, the two doors never mixing (a browser session on the agent routes, an agent token on the account
// routes), replays, revoke, re-enrolment, and the refusal limit. All requests come from 127.0.0.1, so the limit test runs last.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann, ben, edition;
const makeAgent = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64url');
  return { pub, sign: m => crypto.sign(null, Buffer.from(m), privateKey).toString('base64url') };
};
const nonce = () => crypto.randomBytes(12).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
/** A request as an agent makes it: no cookie, no CSRF, JSON, an optional bearer token. */
async function agent(method, p, body, { token = null, headers = {}, base = s.url } = {}) {
  const h = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers };
  if (body !== undefined && !Object.keys(h).some(k => k.toLowerCase() === 'content-type')) h['content-type'] = 'application/json';
  const r = await fetch(new URL(p, base), { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text, headers: r.headers };
}
const enrolBody = (a, code) => ({ code, publicKey: a.pub, signature: a.sign(`v1|enrol|${code}|${a.pub}`) });
const sessionBody = (a, slot, ts = now(), n = nonce()) => ({ slot, timestamp: ts, nonce: n, signature: a.sign(`v1|session|${slot}|${ts}|${n}`) });
const S = {};   // shared between the tests, which run in order

before(async () => {
  s = await startServer({ population: 150, agents: 3 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  ben = await userSession(s, owner, { login: 'ben', displayName: 'Ben', role: 'member' });
});
after(async () => { await s?.stop(); });

test('an owner-side slot: a member creates one, sees the code once, and nobody else sees it', async () => {
  assert.equal((await agent('GET', '/api/agent-slots')).status, 401, 'a guest cannot');
  assert.equal((await agent('POST', '/api/agent-slots', { name: 'x' })).status, 401);
  const made = await ann.post('/api/agent-slots', { name: 'Claude Code' });
  assert.equal(made.status, 200, made.text);
  assert.match(made.json.code, /^mvwe_/); assert.equal(made.json.slot.status, 'pending'); assert.equal(made.json.slot.visibility, 'hidden'); assert.equal(made.json.slot.chatAudience, 'owner');
  S.slot = made.json.slot.id; S.code = made.json.code;
  const list = await ann.get('/api/agent-slots');
  assert.equal(list.status, 200); assert.equal(list.json.agents.length, 1);
  assert.equal(list.text.includes(S.code), false, 'the code is never shown again');
  assert.deepEqual((await ben.get('/api/agent-slots')).json.agents, [], 'another account sees nothing');
  assert.deepEqual((await owner.get('/api/agent-slots')).json.agents, [], 'not even the owner sees another account\'s agents');
  assert.equal((await ann.post('/api/agent-slots', { name: 'claude code' })).status, 409);
  assert.equal((await ann.post('/api/agent-slots', { name: '' })).status, 400);
});

test('enrolment over HTTP: the agent signs, the code works once, and the wrong key or the wrong code is refused (I8.14)', async () => {
  const a = makeAgent(); S.a = a;
  const wrong = await agent('POST', '/api/agent-api/enroll', { code: S.code, publicKey: a.pub, signature: makeAgent().sign('x') });
  assert.equal(wrong.status, 401); assert.equal(wrong.json.code, 'enrol_refused'); assert.equal(wrong.headers.get('cache-control'), 'no-store');
  const ok = await agent('POST', '/api/agent-api/enroll', enrolBody(a, S.code));
  assert.equal(ok.status, 200, ok.text); assert.equal(ok.json.slot.status, 'active'); assert.equal(ok.json.slot.id, S.slot);
  assert.equal(ok.text.includes(a.pub), false, 'the answer does not echo the key');
  assert.equal((await agent('POST', '/api/agent-api/enroll', enrolBody(makeAgent(), S.code))).status, 401, 'the code is single use');
  assert.equal((await agent('POST', '/api/agent-api/enroll', 'not json', { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await agent('POST', '/api/agent-api/enroll', {})).status, 401);
  assert.equal((await ann.get('/api/agent-slots')).json.agents[0].status, 'active');
  // its owner's OK: until then the key opens nothing, and nobody else can give it
  assert.equal(ok.json.approval, 'waiting'); assert.equal((await ann.get('/api/agent-slots')).json.agents[0].approval, 'waiting');
  const early = await agent('POST', '/api/agent-api/session', sessionBody(a, S.slot));
  assert.equal(early.status, 403, early.text); assert.equal(early.json.code, 'awaiting_approval');
  assert.equal((await ben.post('/api/agent-slots/approve', { id: S.slot })).status, 404, 'nobody else approves it');
  assert.equal((await owner.post('/api/agent-slots/approve', { id: S.slot })).status, 404, 'not even the installation owner');
  const ap = await ann.post('/api/agent-slots/approve', { id: S.slot });
  assert.equal(ap.status, 200, ap.text); assert.equal(ap.json.agent.approval, 'approved');
});

test('a signed login gives a token; a replay, a stale clock and a stranger\'s signature are refused; the token finds its own agent (I8.14)', async () => {
  const body = sessionBody(S.a, S.slot);
  const s1 = await agent('POST', '/api/agent-api/session', body);
  assert.equal(s1.status, 200, s1.text); assert.match(s1.json.token, /^mvws_/); assert.equal(s1.json.slot, S.slot);
  S.token = s1.json.token;
  const replay = await agent('POST', '/api/agent-api/session', body);
  assert.equal(replay.status, 401); assert.equal(replay.json.code, 'resign'); assert.equal(replay.json.resign, true);
  assert.equal((await agent('POST', '/api/agent-api/session', sessionBody(S.a, S.slot, now() - 120))).status, 401, 'clock');
  assert.equal((await agent('POST', '/api/agent-api/session', sessionBody(makeAgent(), S.slot))).status, 401, 'a key that is not enrolled');
  const me = await agent('GET', '/api/agent-api/me', undefined, { token: S.token });
  assert.equal(me.status, 200, me.text); assert.equal(me.json.agent.id, S.slot); assert.equal(me.json.agent.name, 'Claude Code'); assert.equal(me.json.edition, 'self-hosted');
  assert.equal(me.headers.get('cache-control'), 'no-store');
  for (const bad of [undefined, 'mvws_' + 'A'.repeat(43), S.token + 'x', 'Basic abc']) {
    const r = await agent('GET', '/api/agent-api/me', undefined, bad === undefined ? {} : bad.startsWith('Basic') ? { headers: { authorization: bad } } : { token: bad });
    assert.equal(r.status, 401); assert.equal(r.json.resign, true);
  }
});

test('the two doors never mix: a browser session is nothing on the agent routes and an agent token is nothing on the account routes', async () => {
  const cookie = await agent('GET', '/api/agent-api/me', undefined, { headers: { cookie: ann.cookie, 'x-csrf-token': ann.csrf } });
  assert.equal(cookie.status, 401, 'ann\'s signed-in browser cannot act as an agent');
  const own = await agent('GET', '/api/agent-slots', undefined, { token: S.token });
  assert.equal(own.status, 401, 'the agent\'s token is not a login');
  for (const [m, p, b] of [['POST', '/api/agent-slots/update', { id: S.slot, visibility: 'public' }], ['POST', '/api/agent-slots/revoke', { id: S.slot }], ['POST', '/api/agent-slots/code', { id: S.slot }], ['POST', '/api/agent-slots', { name: 'Sneaky' }],
    ['POST', '/api/chat-sessions/create', { agent: 1, label: 'x' }], ['GET', '/api/connections'], ['GET', '/api/auth/me']]) {
    const r = await agent(m, p, b, { token: S.token, headers: { 'x-csrf-token': 'anything' } });
    if (p === '/api/auth/me') assert.equal(r.json.account, null, 'the agent is a guest there');
    else assert.equal(r.status, 401, `${m} ${p}`);
  }
  assert.equal((await ann.get('/api/agent-slots')).json.agents[0].visibility, 'hidden', 'nothing changed');
  const evil = await agent('POST', '/api/agent-api/session', sessionBody(S.a, S.slot), { headers: { cookie: ann.cookie, origin: 'https://evil.example' } });
  assert.equal(evil.status, 200, 'an agent route takes no cookie, so a foreign Origin means nothing there (and CSRF does not apply)');
});

test('another account cannot see, change, revoke or re-key the agent; the owner can (X11)', async () => {
  for (const [p, b] of [['/api/agent-slots/update', { id: S.slot, visibility: 'public' }], ['/api/agent-slots/revoke', { id: S.slot }], ['/api/agent-slots/code', { id: S.slot }]]) {
    assert.equal((await ben.post(p, b)).status, 404, p);
    assert.equal((await owner.post(p, b)).status, 404, `${p}: not even the installation owner`);
  }
  assert.equal((await ann.post('/api/agent-slots/update', { id: 99999, name: 'x' })).status, 404);
  assert.equal((await ann.post('/api/agent-slots/update', { id: 'abc', name: 'x' })).status, 404);
  const u = await ann.post('/api/agent-slots/update', { id: S.slot, visibility: 'friends', chatAudience: 'friends', appearInWorld: true, chatPaused: false, status: 'revoked', pubkey: 'x' });
  assert.equal(u.status, 200, u.text); assert.deepEqual([u.json.agent.visibility, u.json.agent.chatAudience, u.json.agent.appearInWorld, u.json.agent.status], ['friends', 'friends', true, 'active']);
  assert.equal((await ann.post('/api/agent-slots/update', { id: S.slot, visibility: 'everyone' })).status, 400);
  assert.equal((await ben.get('/api/agent-slots')).json.agents.length, 0);
  // a second agent for ben is his alone, and his agent cannot sign for ann's slot
  const bm = await ben.post('/api/agent-slots', { name: 'Ben agent' }), b = makeAgent();
  assert.equal((await agent('POST', '/api/agent-api/enroll', enrolBody(b, bm.json.code))).status, 200);
  assert.equal((await ann.post('/api/agent-slots/approve', { id: bm.json.slot.id })).status, 404, 'ann cannot approve ben\'s');
  assert.equal((await ben.post('/api/agent-slots/approve', { id: bm.json.slot.id })).status, 200);
  assert.equal((await agent('POST', '/api/agent-api/session', sessionBody(b, S.slot))).status, 401);
  const bs = await agent('POST', '/api/agent-api/session', sessionBody(b, bm.json.slot.id));
  const bme = await agent('GET', '/api/agent-api/me', undefined, { token: bs.json.token });
  assert.equal(bme.json.agent.id, bm.json.slot.id); assert.notEqual(bme.json.agent.id, S.slot, 'a token finds its own agent only');
});

test('revoke ends the agent\'s session at once; a new code re-enrols the same slot with a new key and keeps its settings (C124)', async () => {
  const rev = await ann.post('/api/agent-slots/revoke', { id: S.slot });
  assert.equal(rev.status, 200, rev.text); assert.equal(rev.json.agent.status, 'revoked');
  const me = await agent('GET', '/api/agent-api/me', undefined, { token: S.token });
  assert.equal(me.status, 401, 'the session ended at once');
  assert.equal((await agent('POST', '/api/agent-api/session', sessionBody(S.a, S.slot))).status, 401, 'the lost key is dead');
  const c = await ann.post('/api/agent-slots/code', { id: S.slot });
  assert.equal(c.status, 200, c.text); assert.match(c.json.code, /^mvwe_/); assert.equal(c.json.slot.status, 'pending');
  const b = makeAgent();
  const en = await agent('POST', '/api/agent-api/enroll', enrolBody(b, c.json.code));
  assert.equal(en.status, 200, en.text); assert.equal(en.json.slot.id, S.slot); assert.equal(en.json.slot.name, 'Claude Code');
  assert.deepEqual([en.json.slot.visibility, en.json.slot.chatAudience, en.json.slot.appearInWorld], ['friends', 'friends', true], 'settings kept');
  assert.equal((await agent('POST', '/api/agent-api/session', sessionBody(S.a, S.slot))).status, 401, 'the old key stays dead');
  assert.equal(en.json.approval, 'waiting', 'a new key waits for its owner\'s OK again');
  assert.equal((await ann.post('/api/agent-slots/approve', { id: S.slot })).status, 200);
  const s2 = await agent('POST', '/api/agent-api/session', sessionBody(b, S.slot));
  assert.equal(s2.status, 200, s2.text);
  assert.equal((await agent('GET', '/api/agent-api/me', undefined, { token: s2.json.token })).status, 200);
});

test('there is no other edition: MVW_EDITION=platform changes nothing (no shop, no plans, demo mode stays)', async () => {
  const p = await startServer({ population: 150, agents: 0, demo: true, env: { MVW_EDITION: 'platform' } });   // demo: no licence is imported
  try {
    const o = await ownerSession(p);
    assert.equal((await o.get('/api/commerce/status')).status, 404, 'no shop');
    assert.equal((await o.get('/api/plans')).status, 404, 'no plans');
    assert.equal((await o.get('/api/licence')).json.mode, 'demo', 'the licence still decides');
  } finally { await p.stop(); }
});

test('too many refused logins stop further tries for a while (last: every request here comes from one address)', async () => {
  let last = null;
  for (let i = 0; i < 14 && !(last && last.status === 429); i++) last = await agent('POST', '/api/agent-api/session', sessionBody(makeAgent(), S.slot));
  assert.equal(last.status, 429); assert.equal(last.json.code, 'rate_limited'); assert.ok(Number(last.headers.get('retry-after')) > 0);
  assert.equal((await agent('POST', '/api/agent-api/enroll', enrolBody(makeAgent(), 'mvwe_' + crypto.randomBytes(20).toString('base64url')))).status, 429);
});
