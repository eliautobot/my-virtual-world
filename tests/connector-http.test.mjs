// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// AI apps over HTTP (server/connector/): what an MCP client (Grok, ChatGPT…) meets — the 401 and its resource metadata,
// the authorization server's metadata, registration, the authorization request sent to the consent page, the person's
// answer through the route table (signed in, CSRF), the token endpoint (form-encoded) — then the MCP endpoint in both eras
// (legacy initialize; modern per-request _meta with its headers checked), tools acting as the person's chosen agent
// through the world's own routes, the admins' switch, and the person disconnecting the app.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';

test('an AI app connects as a person\'s agent and acts through MCP; the admins\' switch; the person disconnects it', { timeout: 240000 }, async () => {
  const s = await startServer({ data: tempDir('mvw-connector-http-'), population: 60, env: {} });
  try {
    const owner = await ownerSession(s);
    // members make their own agents here (the owner's choice: the permissions table)
    assert.equal((await owner.post('/api/permissions', { cap: 'agents.manage', min: 'member' })).status, 200);
    const ann = await userSession(s, owner, { login: 'ann' }), bob = await userSession(s, owner, { login: 'bob' });
    const nova = (await ann.post('/api/agents', { name: 'Nova', emoji: '🚀', role: 'Receptionist' })).json;
    assert.ok(nova.agent?.id || nova.id, JSON.stringify(nova));
    const novaId = nova.agent?.id ?? nova.id;
    const RESOURCE = `${s.url}/mcp`, APP_PORT = 40000 + 3123, APP = `http://127.0.0.1:${APP_PORT}`;

    // discovery: the 401, the resource's metadata, the authorization server's
    const anon = await fetch(RESOURCE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(anon.status, 401);
    assert.match(anon.headers.get('www-authenticate'), new RegExp(`^Bearer resource_metadata="${s.url}/.well-known/oauth-protected-resource/mcp", scope="agent"$`));
    const prm = await (await fetch(`${s.url}/.well-known/oauth-protected-resource/mcp`)).json();
    assert.deepEqual([prm.resource, prm.authorization_servers], [RESOURCE, [s.url]]);
    const asm = await (await fetch(`${s.url}/.well-known/oauth-authorization-server`)).json();
    assert.equal(asm.issuer, s.url);
    assert.deepEqual([asm.code_challenge_methods_supported, asm.client_id_metadata_document_supported, asm.authorization_response_iss_parameter_supported], [['S256'], true, true]);

    // registration, then the authorization request goes to the consent page
    const reg = await fetch(asm.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Grok', redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none' }) });
    assert.equal(reg.status, 201);
    const client = (await reg.json()).client_id;
    const v = crypto.randomBytes(40).toString('base64url'), challenge = crypto.createHash('sha256').update(v).digest('base64url');
    const authz = new URL(asm.authorization_endpoint);
    for (const [k, val] of Object.entries({ client_id: client, redirect_uri: `${APP}/callback`, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'abc', resource: RESOURCE, scope: 'agent' })) authz.searchParams.set(k, val);
    const go = await fetch(authz, { redirect: 'manual' });
    assert.equal(go.status, 302);
    const request = /^\/connect\.html\?request=([A-Za-z0-9_-]+)$/.exec(go.headers.get('location'))?.[1];
    assert.ok(request, go.headers.get('location'));
    const bad = await fetch(`${asm.authorization_endpoint}?client_id=${client}&redirect_uri=${encodeURIComponent('https://evil.example/cb')}&response_type=code`, { redirect: 'manual' });
    assert.equal(bad.status, 400, 'an unregistered redirect is never followed');

    // the consent page: a guest sees the app; Ann sees her agents and allows it as Nova
    const g = await (await fetch(`${s.url}/api/connector/request?id=${request}`)).json();
    assert.deepEqual([g.app.name, g.app.local, g.agents], ['Grok', true, []]);
    const seen = (await ann.get(`/api/connector/request?id=${request}`)).json;
    assert.deepEqual(seen.agents.map(a => a.name), ['Nova']);
    assert.equal((await fetch(`${s.url}/api/connector/consent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request, agent: novaId, allow: true }) })).status, 401, 'a guest can\'t answer');
    const yes = await ann.post('/api/connector/consent', { request, agent: novaId, allow: true });
    assert.equal(yes.status, 200, yes.text);
    const back = new URL(yes.json.redirect);
    assert.deepEqual([back.origin, back.searchParams.get('state'), back.searchParams.get('iss')], [APP, 'abc', s.url]);

    // the token endpoint
    const tok = await fetch(asm.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: client, code: back.searchParams.get('code'), code_verifier: v, redirect_uri: `${APP}/callback`, resource: RESOURCE }) });
    assert.equal(tok.status, 200);
    assert.equal(tok.headers.get('cache-control'), 'no-store');
    const t = await tok.json();
    assert.match(t.access_token, /^mvwa_/);
    const json = await fetch(asm.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal((await json.json()).error, 'invalid_request', 'form-encoded only');

    // MCP, legacy era: initialize, a notification, tools
    const rpc = (body, headers = {}) => fetch(RESOURCE, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${t.access_token}`, ...headers }, body: JSON.stringify(body) });
    const init = await (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'grok', version: '1' } } })).json();
    assert.deepEqual([init.result.protocolVersion, init.result.serverInfo.name, !!init.result.capabilities.tools], ['2025-06-18', 'my-virtual-world', true]);
    assert.match(init.result.instructions, /You act as Nova, ann's agent/);
    assert.equal((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-protocol-version': '2025-06-18' })).status, 202);
    const list = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'mcp-protocol-version': '2025-06-18' })).json();
    const names = list.result.tools.map(x => x.name);
    for (const n of ['my_agent', 'add_plan', 'work_brief', 'update_work_brief', 'visitor_conversations', 'post_spots', 'my_property', 'my_phone', 'phone_texts', 'phone_send_text', 'phone_contacts', 'phone_calls']) assert.ok(names.includes(n), n);
    assert.equal(names.includes('market'), false, 'no land market in money: the shop is the online platform\'s');
    assert.equal(list.result.resultType, undefined, 'legacy results have no resultType');
    const me = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'my_agent', arguments: {} } }, { 'mcp-protocol-version': '2025-06-18' })).json();
    assert.equal(me.result.isError, false, JSON.stringify(me));
    assert.equal(me.result.structuredContent.agent.name, 'Nova');
    assert.match(me.result.content[0].text, /"name":"Nova"/);

    // MCP, modern era: the headers mirror the body
    const M = (method, params = {}, h = {}) => rpc({ jsonrpc: '2.0', id: `m-${method}`, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'grok', version: '2' }, 'io.modelcontextprotocol/clientCapabilities': {} } } },
      { 'mcp-protocol-version': '2026-07-28', 'mcp-method': method, ...(params.name ? { 'mcp-name': params.name } : {}), ...h });
    const disc = await (await M('server/discover')).json();
    assert.deepEqual([disc.result.resultType, disc.result.supportedVersions[0], disc.result._meta['io.modelcontextprotocol/serverInfo'].name], ['complete', '2026-07-28', 'my-virtual-world']);
    const plan = await (await M('tools/call', { name: 'add_plan', arguments: { kind: 'must', text: 'Greet visitors at the front desk', today: true } })).json();
    assert.equal(plan.result.resultType, 'complete'); assert.equal(plan.result.isError, false, JSON.stringify(plan));
    const brief = await (await M('tools/call', { name: 'update_work_brief', arguments: { company: 'Acme Robots — friendly robots for small shops' } })).json();
    assert.equal(brief.result.isError, false, JSON.stringify(brief));
    assert.equal((await ann.get(`/api/agent-work?agent=${novaId}`)).json.brief.company, 'Acme Robots — friendly robots for small shops', 'the person sees what the app did');
    // its PC (docs/features/agent-pc.md): the command line as the agent, its words given as they are
    const pcw = await (await M('tools/call', { name: 'pc', arguments: { run: 'write ~/Documents/from-app.md\nls ~/Documents', text: 'Hi from the app' } })).json();
    assert.equal(pcw.result.isError, false, JSON.stringify(pcw));
    assert.match(pcw.result.content[0].text, /^\$ write ~\/Documents\/from-app\.md\nmade ~\/Documents\/from-app\.md/);
    assert.equal((await ann.get(`/api/pc/text?profile=${novaId}&path=${encodeURIComponent('~/Documents/from-app.md')}`)).json.text, 'Hi from the app', 'the person sees it on the PC');
    const enc = await M('tools/call', { name: 'my_agent', arguments: {} }, { 'mcp-name': `=?base64?${Buffer.from('my_agent').toString('base64')}?=` });
    assert.equal(enc.status, 200, 'a Base64 Mcp-Name is decoded');
    const mism = await M('tools/call', { name: 'my_agent', arguments: {} }, { 'mcp-name': 'add_plan' });
    assert.equal(mism.status, 400); assert.equal((await mism.json()).error.code, -32020);
    const old = await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } } }, { 'mcp-protocol-version': '1900-01-01', 'mcp-method': 'tools/list' });
    assert.equal(old.status, 400);
    const oj = await old.json();
    assert.equal(oj.error.code, -32022); assert.ok(oj.error.data.supported.includes('2026-07-28') && oj.error.data.supported.includes('2025-11-25'));
    const unknown = await M('resources/list');
    assert.equal(unknown.status, 404); assert.equal((await unknown.json()).error.code, -32601);
    const badArgs = await (await M('tools/call', { name: 'add_plan', arguments: { kind: 'maybe', text: 'x' } })).json();
    assert.equal(badArgs.result.isError, true);
    // the endpoint's other rules
    assert.equal((await fetch(RESOURCE, { headers: { authorization: `Bearer ${t.access_token}` } })).status, 405);
    assert.equal((await rpc({ jsonrpc: '2.0', id: 10, method: 'ping' }, { origin: 'https://evil.example' })).status, 403, 'another site\'s page');
    assert.equal((await fetch(RESOURCE, { method: 'POST', headers: { authorization: 'Bearer mvwa_notarealtoken0000000000' }, body: '{}' })).status, 401);

    // the person's list (only theirs), the admins' switch, disconnecting
    const grants = (await ann.get('/api/connector/grants')).json.grants;
    assert.deepEqual(grants.map(x => [x.app, x.agent.name]), [['Grok', 'Nova']]);
    assert.deepEqual((await bob.get('/api/connector/grants')).json.grants, []);
    assert.equal((await bob.post('/api/connector/grants/revoke', { id: grants[0].id })).status, 404);
    assert.equal((await owner.post('/api/settings', { values: { 'connector.enabled': false } })).status, 200);
    assert.equal((await rpc({ jsonrpc: '2.0', id: 11, method: 'ping' })).status, 404, 'switched off: every app stops');
    assert.equal((await fetch(`${s.url}/.well-known/oauth-authorization-server`)).status, 404);
    assert.equal((await owner.post('/api/settings', { values: { 'connector.enabled': true } })).status, 200);
    assert.equal((await rpc({ jsonrpc: '2.0', id: 12, method: 'ping' })).status, 200);
    assert.equal((await ann.post('/api/connector/grants/revoke', { id: grants[0].id })).status, 200);
    const after = await rpc({ jsonrpc: '2.0', id: 13, method: 'ping' });
    assert.equal(after.status, 401); assert.match(after.headers.get('www-authenticate'), /error="invalid_token"/);
  } finally { await s.stop(); }
});
