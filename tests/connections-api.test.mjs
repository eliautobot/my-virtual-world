// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Connections on a real server (PLAN WP2.2, I8.1, I8.7, I8.13, X11; DECISIONS C60, A8, A9): who may add what, that credentials are
// sealed and never come back or reach the log, shares, and Test / discover through the supervised helper with the mock provider.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann, ben, adm;
const TOKEN = 'tok-TOPSECRET-4242';
before(async () => {
  s = await startServer({ population: 150, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  ben = await userSession(s, owner, { login: 'ben', displayName: 'Ben', role: 'member' });
  adm = await userSession(s, owner, { login: 'adm', displayName: 'Adm', role: 'admin' });
});
after(async () => { await s?.stop(); });
const me = async c => (await c.get('/api/auth/me')).json.account.id;

test('the kinds that work are listed (none still to come, no work package named), and the helper is running (I8.1)', async () => {
  const r = (await ann.get('/api/providers')).json;
  assert.deepEqual(r.kinds.map(k => k.id).filter(k => k !== 'mock' && k !== 'decisions-mock'), ['openclaw', 'hermes', 'models', 'openai-decisions', 'voice', 'twilio', 'browser', 'search', 'agentapi']);
  // (agents' phones, docs/features/phone.md: a member adds their own Twilio account; its token is a secret field)
  const tw = r.kinds.find(k => k.id === 'twilio');
  assert.deepEqual([tw.implemented, tw.byok, tw.fields.map(f => `${f.key}:${f.type}`).join(',')], [true, true, 'accountSid:text,apiKeySid:text,authToken:secret']);
  // (Agent Providers: OpenClaw is added in its own window — hub — and a credential the server keeps for it, its device
  // key and token, is never a field of a form)
  const oc = r.kinds.find(k => k.id === 'openclaw');
  assert.equal(oc.hub, true);
  assert.deepEqual(oc.fields.map(f => f.key), ['url', 'auth', 'token', 'password', 'access']);
  assert.equal(r.kinds.find(k => k.id === 'openai-decisions').implemented, true, 'the decision service for Free Will is built in');
  const voice = r.kinds.find(k => k.id === 'voice');
  assert.equal(voice.implemented, true, 'voice services are built in (docs/features/CHAT.md §9)');
  assert.deepEqual(Object.keys(voice.providers), ['openai', 'openrouter', 'groq', 'elevenlabs', 'google', 'deepgram', 'xai', 'qwen', 'custom']);
  const mock = r.kinds.find(k => k.id === 'mock');
  assert.ok(mock && mock.implemented === true, 'the tests load the mock adapter');
  assert.ok(r.kinds.every(k => k.implemented), 'only kinds whose adapter exists');
  assert.ok(!JSON.stringify(r.kinds).includes('WP2.'), 'no work package named');
  assert.equal(r.host.running, true);
  for (const k of r.kinds) for (const f of k.fields) if (f.type === 'secret') assert.equal(f.default, undefined);
  assert.equal((await (await import('./helpers/server.mjs')).httpClient(s.url).get('/api/providers')).status, 401, 'signed out: not even the list');
});

test('a member adds a personal remote connection; its credential is sealed and never comes back or reaches the log (I8.7)', async () => {
  const c = await ann.post('/api/connections', { kind: 'mock', label: 'Ann mock', config: { url: 'http://mock.invalid/' }, secrets: { token: TOKEN } });
  assert.equal(c.status, 200, c.text);
  assert.equal(c.json.scope, 'account'); assert.equal(c.json.level, 'manage'); assert.equal(c.json.mine, true);
  assert.deepEqual(c.json.secrets, { token: true }, 'only whether it is set');
  const list = await ann.get('/api/connections');
  assert.equal(JSON.stringify(list.json).includes('TOPSECRET'), false, 'never in a response');
  const t = await ann.post('/api/connections/test', { id: c.json.id });
  assert.equal(t.status, 200, t.text); assert.equal(t.json.ok, true); assert.equal(t.json.detail, 'Mock reachable');
  const ok = await ann.post('/api/connections/update', { id: c.json.id, secrets: { token: '' } });
  assert.equal(ok.json.secrets.token, true, 'a blank keeps the stored credential');
  const bad = await ann.post('/api/connections/update', { id: c.json.id, secrets: { token: 'wrong' } });
  assert.equal(bad.status, 200);
  const t2 = await ann.post('/api/connections/test', { id: c.json.id });
  assert.equal(t2.json.ok, false); assert.match(t2.json.fix, /token/i, 'a failure says what to fix');
  const d = await ann.post('/api/connections/discover', { id: c.json.id });
  assert.equal(d.json.agents.length, 2);
  assert.equal(s.log().includes('TOPSECRET'), false, 'never in the server log');
  await ann.post('/api/connections/update', { id: c.json.id, secrets: { token: TOKEN } });
});

test('others never see a personal connection, not even an admin or the owner; they get 404, not 403 (X11)', async () => {
  const id = (await ann.get('/api/connections')).json.connections[0].id;
  for (const who of [ben, adm, owner]) {
    assert.equal((await who.get('/api/connections')).json.connections.some(c => c.id === id), false);
    for (const a of ['update', 'remove', 'share', 'unshare', 'test', 'refresh', 'discover']) assert.equal((await who.post(`/api/connections/${a}`, { id, kind: 'role', who: 'admin', label: 'x' })).status, 404, `${a}`);
  }
});

test('members cannot add host-process or installation-wide connections; an admin can, and shares them (I8.13, A9)', async () => {
  const host = await ann.post('/api/connections', { kind: 'codex', config: {} });
  assert.equal(host.status, 403); assert.equal(host.json.code, 'host_process_is_infrastructure');
  const inst = await ann.post('/api/connections', { kind: 'mock', scope: 'installation', config: {}, secrets: { token: TOKEN } });
  assert.equal(inst.status, 403);
  assert.equal((await ann.post('/api/connections', { kind: 'nope' })).status, 400);
  const c = await adm.post('/api/connections', { kind: 'mock', label: 'Shared mock', scope: 'installation', config: {}, secrets: { token: TOKEN } });
  assert.equal(c.status, 200, c.text); assert.equal(c.json.scope, 'installation'); assert.equal(c.json.level, 'manage');
  const h = await adm.post('/api/connections', { kind: 'codex', scope: 'installation', config: {} });
  assert.equal(h.status, 200, h.text); assert.equal(h.json.connectionKind, 'host-process'); assert.equal(h.json.implemented, false);
  const t = await adm.post('/api/connections/test', { id: h.json.id });
  assert.equal(t.json.ok, false); assert.match(t.json.error, /isn't available on this server/, 'an unbuilt adapter says it does not work here (never a work package: 2026-10-09)');
  assert.equal((await ben.get('/api/connections')).json.connections.some(x => x.id === c.json.id), false, 'not shared: not visible');
  assert.equal((await ben.post('/api/connections/test', { id: c.json.id })).status, 404);
  const annId = await me(ann);
  assert.equal((await adm.post('/api/connections/share', { id: c.json.id, kind: 'account', who: String(annId) })).status, 200);
  const v = (await ann.get('/api/connections')).json.connections.find(x => x.id === c.json.id);
  assert.equal(v.level, 'use'); assert.equal(v.config, undefined); assert.equal(v.secrets, undefined); assert.equal(v.shares, undefined, 'users of a shared connection see no settings');
  assert.equal((await ann.post('/api/connections/update', { id: c.json.id, label: 'Hijack' })).status, 403, 'use is not manage');
  assert.equal((await ann.post('/api/connections/share', { id: c.json.id, kind: 'role', who: 'guest' })).status, 403);
  assert.equal((await ben.get('/api/connections')).json.connections.some(x => x.id === c.json.id), false, 'others still cannot');
  await adm.post('/api/connections/share', { id: c.json.id, kind: 'role', who: 'member' });
  assert.equal((await ben.get('/api/connections')).json.connections.some(x => x.id === c.json.id), true, 'a role share reaches every member');
  assert.equal((await adm.post('/api/connections/unshare', { id: c.json.id, kind: 'role', who: 'member' })).json.shares.length, 1);
  assert.equal((await adm.post('/api/connections/remove', { id: h.json.id })).status, 200);
  assert.equal(s.log().includes('TOPSECRET'), false, 'no credential in the log after all of it');
});

test('bad input is refused with a reason', async () => {
  assert.equal((await ann.post('/api/connections', { kind: 'mock', config: { bogus: 1 } })).status, 400);
  assert.equal((await ann.post('/api/connections', { kind: 'mock', config: { url: 'ws://user:pw@host' } })).status, 400);
  assert.equal((await ann.post('/api/connections', { kind: 'openclaw', config: {} })).status, 400, 'a required credential is missing');
  assert.equal((await ann.post('/api/connections/test', {})).status, 400);
  assert.equal((await ann.post('/api/connections/test', { id: 99999 })).status, 404);
});

test('connections survive a restart with their credentials sealed and readable by the helper', async () => {
  const dir = s.data, pw = { ann: ann.password };
  const before = (await ann.get('/api/connections')).json.connections.find(c => c.label === 'Ann mock');
  await s.stop({ keepData: true });
  s = await startServer({ data: dir, env: { MVW_PROVIDER_TEST: '1', MVW_KEY_FILE: s.keyFile } });
  const again = (await import('./helpers/server.mjs')).httpClient(s.url);
  await again.signIn('ann', pw.ann);
  const after = (await again.get('/api/connections')).json.connections.find(c => c.label === 'Ann mock');
  assert.equal(after.id, before.id); assert.deepEqual(after.secrets, { token: true });
  const t = await again.post('/api/connections/test', { id: after.id });
  assert.equal(t.json.ok, true, 'the sealed credential opened after the restart and reached the helper');
});
