// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// AI apps' authorization server (server/connector/auth.js): registrations (RFC 7591) and client ID metadata documents;
// the authorization request's checks (the app, its exact redirect URI - loopback with any port -, code, PKCE S256, the
// resource, the scope), the person's answer (deny; allow as one of THEIR agents), single-use codes with the PKCE verifier,
// short access tokens bound to this resource, refresh tokens replaced at every use - a code or refresh token used twice
// ends the grant -, confidential apps' secrets; a grant ends with its agent, its account, or the person disconnecting it.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { Accounts } from '../server/auth/accounts.js';
import { Agents } from '../server/agents.js';
import { ConnectorAuth, redirectOk, redirectMatches, CONNECTOR_LIMITS } from '../server/connector/auth.js';
import { tempDir } from '../tools/lib/testserver.mjs';

const ISSUER = 'https://world.example', RESOURCE = `${ISSUER}/mcp`, WHERE = { issuer: ISSUER, resource: RESOURCE };
const DOC_ID = 'https://ai.example/oauth/client.json';
const PORT = 3000 + 7, ANY = 50000 + 3412;   // (ports in the examples: any; written as numbers, not as one installation's address)
const pkce = () => { const v = crypto.randomBytes(40).toString('base64url'); return { verifier: v, challenge: crypto.createHash('sha256').update(v).digest('base64url') }; };

async function rig() {
  const dir = tempDir('mvw-connector-'), s = openDb(dir);
  let now = Date.UTC(2026, 9, 10, 12);
  const docs = new Map([[DOC_ID, { client_id: DOC_ID, client_name: 'Grok', client_uri: 'https://ai.example', redirect_uris: ['https://ai.example/callback'], token_endpoint_auth_method: 'none' }]]);
  let docsDown = false, fetched = 0;
  const acc = new Accounts(s, { dataDir: dir, now: () => now });
  const agents = new Agents(s, { now: () => now });
  const mk = async login => (await acc.createAccount({ login, displayName: login, role: 'member', password: 'Correct-Horse-Battery-9', mustChange: false })).user;
  const ann = await mk('ann'), bob = await mk('bob');
  const session = u => acc.startSession(acc.q.byId.get({ w: s.worldId, id: u.id }), { ip: '203.0.113.5' }).principal;
  const nova = agents.create({ key: 'nova', name: 'Nova', role: 'Receptionist', ownerId: ann.id });
  const rex = agents.create({ key: 'rex', name: 'Rex', ownerId: bob.id });
  const audit = [];
  const auth = new ConnectorAuth(s, { accounts: acc, agents, audit: { log: (what, x) => audit.push({ what, ...x }) }, now: () => now,
    fetchDocument: async url => { fetched++; if (docsDown) throw new Error('down'); const d = docs.get(url); if (!d) throw new Error('404'); return d; } });
  acc.connector = auth;
  /** The whole dance for an app: authorize, the person allows (as agent), the code for tokens. */
  const connect = async ({ client = DOC_ID, redirect = 'https://ai.example/callback', P = session(ann), agent = nova.id, extra = {} } = {}) => {
    const k = pkce();
    const q = new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: 'code', code_challenge: k.challenge, code_challenge_method: 'S256', state: 'st-1', resource: RESOURCE, scope: 'agent', ...extra });
    const a = await auth.authorize(q, WHERE);
    assert.ok(a.request, JSON.stringify(a));
    const c = auth.consent(P, { request: a.request, agent, allow: true }, { issuer: ISSUER });
    const u = new URL(c.redirect);
    return { ...k, code: u.searchParams.get('code'), redirect: u, grant: c.grant, request: a.request };
  };
  const form = o => new URLSearchParams(o);
  return { s, acc, agents, auth, ann, bob, nova, rex, session, connect, form, docs, audit, setDocsDown: v => { docsDown = v; }, fetched: () => fetched, tick: ms => { now += ms; },
    close: () => { s.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('redirect URIs: https anywhere, http only to this computer, app schemes; loopback matches with any port', () => {
  for (const ok of ['https://ai.example/cb', `http://localhost:${PORT}/cb`, 'http://127.0.0.1/cb', `http://[::1]:${PORT}/x`, 'com.example.app:/oauth']) assert.ok(redirectOk(ok), ok);
  for (const no of ['http://ai.example/cb', 'https://ai.example/cb#frag', 'javascript:alert(1)', 'myapp:/cb', 'https://user:pw@ai.example/cb', 'not a url']) assert.ok(!redirectOk(no), no);
  assert.ok(redirectMatches(['http://127.0.0.1/cb'], `http://127.0.0.1:${ANY}/cb`), 'any loopback port (RFC 8252)');
  assert.ok(!redirectMatches(['http://127.0.0.1/cb'], `http://127.0.0.1:${ANY}/other`));
  assert.ok(!redirectMatches(['https://ai.example/cb'], 'https://ai.example/cb/'), 'otherwise exact');
});

test('registration (RFC 7591): what is accepted, a secret only for confidential apps, rate-limited per address', async () => {
  const R = await rig();
  try {
    const pub = R.auth.register({ client_name: 'Desk App', redirect_uris: ['http://127.0.0.1/cb'] }, { ip: '198.51.100.1' });
    assert.match(pub.client_id, /^mvwc_/); assert.equal(pub.client_secret, undefined); assert.equal(pub.token_endpoint_auth_method, 'none');
    const conf = R.auth.register({ client_name: 'Cloud App', redirect_uris: ['https://cloud.example/cb'], token_endpoint_auth_method: 'client_secret_basic' }, { ip: '198.51.100.1' });
    assert.match(conf.client_secret, /^mvws_/);
    assert.equal(R.s.db.prepare('SELECT secret_hash FROM mcp_clients WHERE id = ?').get(conf.client_id).secret_hash.length, 64, 'only the hash is kept');
    assert.throws(() => R.auth.register({ redirect_uris: ['http://evil.example/cb'] }, { ip: '198.51.100.2' }), { code: 'invalid_redirect_uri' });
    assert.throws(() => R.auth.register({ redirect_uris: [] }, { ip: '198.51.100.2' }), { code: 'invalid_redirect_uri' });
    assert.throws(() => R.auth.register({ redirect_uris: ['https://a.example/cb'], grant_types: ['client_credentials'] }, { ip: '198.51.100.2' }), { code: 'invalid_client_metadata' });
    assert.throws(() => R.auth.register({ redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'private_key_jwt' }, { ip: '198.51.100.2' }), { code: 'invalid_client_metadata' });
    for (let i = 0; i < CONNECTOR_LIMITS.registrationsPerHour; i++) R.auth.register({ redirect_uris: ['https://a.example/cb'] }, { ip: '198.51.100.3' });
    assert.throws(() => R.auth.register({ redirect_uris: ['https://a.example/cb'] }, { ip: '198.51.100.3' }), { code: 'slow_down' });
    assert.ok(R.audit.some(x => x.what === 'connector.register'));
  } finally { R.close(); }
});

test('the authorization request: the app and its redirect URI are trusted first; then errors go back to the app with state and iss', async () => {
  const R = await rig();
  try {
    const k = pkce(), base = { client_id: DOC_ID, redirect_uri: 'https://ai.example/callback', response_type: 'code', code_challenge: k.challenge, code_challenge_method: 'S256', state: 'xyz' };
    const ask = o => R.auth.authorize(new URLSearchParams({ ...base, ...o }), WHERE);
    await assert.rejects(ask({ client_id: 'mvwc_unknown' }), { code: 'invalid_client' });
    await assert.rejects(ask({ redirect_uri: 'https://evil.example/callback' }), { code: 'invalid_request' }, 'never redirected to an address the app did not register');
    const err = async (o, code) => { const r = await ask(o); const u = new URL(r.redirect); assert.equal(u.origin + u.pathname, 'https://ai.example/callback'); assert.equal(u.searchParams.get('error'), code); assert.equal(u.searchParams.get('state'), 'xyz'); assert.equal(u.searchParams.get('iss'), ISSUER); };
    await err({ response_type: 'token' }, 'unsupported_response_type');
    await err({ code_challenge_method: 'plain' }, 'invalid_request');
    await err({ code_challenge: 'short' }, 'invalid_request');
    await err({ resource: 'https://other.example/mcp' }, 'invalid_target');
    await err({ scope: 'agent admin' }, 'invalid_scope');
    assert.ok((await ask({ resource: 'HTTPS://WORLD.EXAMPLE/mcp' })).request, 'the resource compares without case in scheme and host');
    assert.ok((await ask({ resource: ISSUER })).request, 'or names the world itself');
    // a client document: fetched once and kept an hour; a wrong one is refused; one that is down keeps working from before
    assert.equal(R.fetched(), 1);
    R.docs.set('https://bad.example/c.json', { client_id: 'https://bad.example/other.json', client_name: 'X', redirect_uris: ['https://bad.example/cb'] });
    await assert.rejects(R.auth.authorize(new URLSearchParams({ ...base, client_id: 'https://bad.example/c.json', redirect_uri: 'https://bad.example/cb' }), WHERE), { code: 'invalid_client' });
    R.tick(CONNECTOR_LIMITS.docCacheMs + 1); R.setDocsDown(true);
    assert.ok((await ask({})).request, 'a known app keeps working while its document is down');
  } finally { R.close(); }
});

test('the person allows as one of THEIR agents (or says no); the code gives tokens once, with the PKCE verifier', async () => {
  const R = await rig();
  try {
    const P = R.session(R.ann);
    // no
    const k = pkce();
    const a = await R.auth.authorize(new URLSearchParams({ client_id: DOC_ID, response_type: 'code', code_challenge: k.challenge, code_challenge_method: 'S256', state: 's' }), WHERE);
    const pend = await R.auth.pending(a.request, P);
    assert.deepEqual([pend.app.name, pend.app.returnsTo, pend.agents.map(x => x.name)], ['Grok', 'ai.example', ['Nova']], 'only her agents');
    const no = new URL(R.auth.consent(P, { request: a.request, allow: false }, { issuer: ISSUER }).redirect);
    assert.equal(no.searchParams.get('error'), 'access_denied'); assert.equal(no.searchParams.get('iss'), ISSUER);
    assert.throws(() => R.auth.consent(P, { request: a.request, allow: true, agent: R.nova.id }, { issuer: ISSUER }), { code: 'expired' }, 'a request is answered once');
    // not someone else's agent
    const b = await R.auth.authorize(new URLSearchParams({ client_id: DOC_ID, response_type: 'code', code_challenge: k.challenge, code_challenge_method: 'S256' }), WHERE);
    assert.throws(() => R.auth.consent(P, { request: b.request, allow: true, agent: R.rex.id }, { issuer: ISSUER }), { code: 'invalid_request' });
    // yes: code → tokens
    const c = await R.connect();
    assert.equal(c.redirect.searchParams.get('state'), 'st-1'); assert.equal(c.redirect.searchParams.get('iss'), ISSUER);
    await assert.rejects(R.auth.token(R.form({ grant_type: 'authorization_code', client_id: DOC_ID, code: c.code, code_verifier: pkce().verifier }), WHERE), { code: 'invalid_grant' }, 'the wrong verifier');
    await assert.rejects(R.auth.token(R.form({ grant_type: 'authorization_code', client_id: DOC_ID, code: c.code, code_verifier: c.verifier, redirect_uri: 'https://ai.example/other' }), WHERE), { code: 'invalid_grant' });
    const t = await R.auth.token(R.form({ grant_type: 'authorization_code', client_id: DOC_ID, code: c.code, code_verifier: c.verifier, redirect_uri: 'https://ai.example/callback', resource: RESOURCE }), WHERE);
    assert.match(t.access_token, /^mvwa_/); assert.match(t.refresh_token, /^mvwr_/); assert.equal(t.token_type, 'Bearer'); assert.equal(t.expires_in, 3600); assert.equal(t.scope, 'agent');
    const who = R.auth.authenticate(t.access_token, RESOURCE);
    assert.deepEqual([who.P.account.login, who.agent.name, who.P.session, who.P.via], ['ann', 'Nova', null, 'connector']);
    assert.equal(R.auth.authenticate(t.access_token, 'https://other.example/mcp'), null, 'only for this resource');
    // the code again: the grant ends (one of the two was stolen)
    await assert.rejects(R.auth.token(R.form({ grant_type: 'authorization_code', client_id: DOC_ID, code: c.code, code_verifier: c.verifier }), WHERE), { code: 'invalid_grant' });
    assert.equal(R.auth.authenticate(t.access_token, RESOURCE), null);
    assert.equal(R.auth.grantsOf(R.ann.id).length, 0);
    // an expired code
    const c2 = await R.connect();
    R.tick(CONNECTOR_LIMITS.codeMs + 1);
    await assert.rejects(R.auth.token(R.form({ grant_type: 'authorization_code', client_id: DOC_ID, code: c2.code, code_verifier: c2.verifier }), WHERE), { code: 'invalid_grant' });
    assert.ok(R.audit.some(x => x.what === 'connector.grant') && R.audit.some(x => x.what === 'connector.end'));
  } finally { R.close(); }
});

test('a client document that names another token method but supports none (ChatGPT) connects as a public app; one without none is refused', async () => {
  const R = await rig();
  try {
    const GPT = 'https://chatgpt.example/oauth/client.json', STRICT = 'https://strict.example/oauth/client.json';
    R.docs.set(GPT, { client_id: GPT, client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.example/connector_platform_oauth_redirect'], token_endpoint_auth_method: 'private_key_jwt', token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'] });
    R.docs.set(STRICT, { client_id: STRICT, client_name: 'Strict', redirect_uris: ['https://strict.example/cb'], token_endpoint_auth_method: 'private_key_jwt' });
    const c = await R.connect({ client: GPT, redirect: 'https://chatgpt.example/connector_platform_oauth_redirect' });
    const t = await R.auth.token(R.form({ grant_type: 'authorization_code', client_id: GPT, code: c.code, code_verifier: c.verifier, redirect_uri: 'https://chatgpt.example/connector_platform_oauth_redirect', resource: RESOURCE }), WHERE);
    assert.ok(t.access_token && t.refresh_token, 'PKCE is its proof, as for any public app');
    assert.equal((await R.auth.client(GPT)).authMethod, 'none');
    assert.equal(await R.auth.client(STRICT), null, 'an app that can only use private_key_jwt is not taken (this world does not verify client assertions)');
  } finally { R.close(); }
});

test('refresh tokens are replaced at every use; a reused one ends the grant; access tokens expire', async () => {
  const R = await rig();
  try {
    const c = await R.connect();
    const t1 = await R.auth.token(R.form({ grant_type: 'authorization_code', client_id: DOC_ID, code: c.code, code_verifier: c.verifier }), WHERE);
    const t2 = await R.auth.token(R.form({ grant_type: 'refresh_token', client_id: DOC_ID, refresh_token: t1.refresh_token }), WHERE);
    assert.notEqual(t2.refresh_token, t1.refresh_token);
    assert.ok(R.auth.authenticate(t2.access_token, RESOURCE));
    R.tick(CONNECTOR_LIMITS.accessMs + 1);
    assert.equal(R.auth.authenticate(t2.access_token, RESOURCE), null, 'an hour');
    const t3 = await R.auth.token(R.form({ grant_type: 'refresh_token', client_id: DOC_ID, refresh_token: t2.refresh_token }), WHERE);
    assert.ok(R.auth.authenticate(t3.access_token, RESOURCE));
    await assert.rejects(R.auth.token(R.form({ grant_type: 'refresh_token', client_id: DOC_ID, refresh_token: t1.refresh_token }), WHERE), { code: 'invalid_grant' });
    assert.equal(R.auth.authenticate(t3.access_token, RESOURCE), null, 'a reused refresh token ends everything');
    await assert.rejects(R.auth.token(R.form({ grant_type: 'password', client_id: DOC_ID }), WHERE), { code: 'unsupported_grant_type' });
  } finally { R.close(); }
});

test('confidential apps prove their secret (Basic or form); revocation; a grant ends with its agent, its account or the person', async () => {
  const R = await rig();
  try {
    const app = R.auth.register({ client_name: 'Cloud App', redirect_uris: ['https://cloud.example/cb'], token_endpoint_auth_method: 'client_secret_basic' }, { ip: '198.51.100.9' });
    const basic = (id, sec) => `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(sec)}`).toString('base64')}`;
    const c = await R.connect({ client: app.client_id, redirect: 'https://cloud.example/cb' });
    await assert.rejects(R.auth.token(R.form({ grant_type: 'authorization_code', client_id: app.client_id, code: c.code, code_verifier: c.verifier }), WHERE), { code: 'invalid_client' }, 'no secret');
    await assert.rejects(R.auth.token(R.form({ grant_type: 'authorization_code', code: c.code, code_verifier: c.verifier }), { ...WHERE, authHeader: basic(app.client_id, 'wrong') }), { code: 'invalid_client' });
    const t = await R.auth.token(R.form({ grant_type: 'authorization_code', code: c.code, code_verifier: c.verifier }), { ...WHERE, authHeader: basic(app.client_id, app.client_secret) });
    assert.ok(R.auth.authenticate(t.access_token, RESOURCE));
    // the app revokes its refresh token: the grant ends
    await R.auth.revoke(R.form({ token: t.refresh_token }), { authHeader: basic(app.client_id, app.client_secret) });
    assert.equal(R.auth.authenticate(t.access_token, RESOURCE), null);
    // the person's list and disconnecting
    const d = await R.connect();
    const td = await R.auth.token(R.form({ grant_type: 'authorization_code', client_id: DOC_ID, code: d.code, code_verifier: d.verifier }), WHERE);
    const list = R.auth.grantsOf(R.ann.id);
    assert.deepEqual(list.map(g => [g.app, g.agent.name]), [['Grok', 'Nova']]);
    assert.throws(() => R.auth.revokeGrant(R.session(R.bob), list[0].id), { code: 'not_found' }, 'not someone else\'s');
    R.auth.revokeGrant(R.session(R.ann), list[0].id);
    assert.equal(R.auth.authenticate(td.access_token, RESOURCE), null);
    // its agent given away: the grant ends
    const e = await R.connect();
    const te = await R.auth.token(R.form({ grant_type: 'authorization_code', client_id: DOC_ID, code: e.code, code_verifier: e.verifier }), WHERE);
    R.agents.update(R.nova.id, { ownerId: R.bob.id });
    assert.equal(R.auth.authenticate(te.access_token, RESOURCE), null);
    R.agents.update(R.nova.id, { ownerId: R.ann.id });
    // the account deleted: every grant ends
    const f = await R.connect();
    const tf = await R.auth.token(R.form({ grant_type: 'authorization_code', client_id: DOC_ID, code: f.code, code_verifier: f.verifier }), WHERE);
    R.acc.removeOwned(R.ann.id);
    assert.equal(R.auth.authenticate(tf.access_token, RESOURCE), null);
    assert.equal(R.auth.grantsOf(R.ann.id).length, 0);
  } finally { R.close(); }
});
