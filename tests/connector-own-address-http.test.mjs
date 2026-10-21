// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Each connected agent has its own MCP address (schema 46, 2026-10-13: a Grok account's bots share their connectors, and
// an app reuses the sign-in it already has for an address — so a second Bot quietly acted as the first Bot's agent). An
// app that signs in at <world>/mcp/a/<handle> can only be that agent: its sign-in offers only it, to its owner only, and its
// tokens work only there; the world's /mcp stays for any agent. The facts name the agent. Deleting a connected agent
// disconnects its app and frees its place.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';

const APP = `http://127.0.0.1:${40000 + 3126}`;

/** An AI app's sign-in for one address: register, authorize (naming that address as the resource) → { request, finish }. */
async function signIn(s, resource, name = 'Grok Bot') {
  const asm = await (await fetch(`${s.url}/.well-known/oauth-authorization-server`)).json();
  const reg = await (await fetch(asm.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: name, redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none' }) })).json();
  const v = crypto.randomBytes(40).toString('base64url'), challenge = crypto.createHash('sha256').update(v).digest('base64url');
  const authz = new URL(asm.authorization_endpoint);
  for (const [k, val] of Object.entries({ client_id: reg.client_id, redirect_uri: `${APP}/callback`, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 's', resource, scope: 'agent' })) authz.searchParams.set(k, val);
  const loc = (await fetch(authz, { redirect: 'manual' })).headers.get('location');
  const request = /request=([A-Za-z0-9_-]+)/.exec(loc || '')?.[1] || null;
  const finish = async redirect => {
    const code = new URL(redirect).searchParams.get('code');
    const t = await (await fetch(asm.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: reg.client_id, code, code_verifier: v, redirect_uri: `${APP}/callback`, resource }) })).json();
    return t;
  };
  return { request, loc, finish };
}
/** An MCP call with a token at an address → { status, json }. */
async function rpc(url, token, method, params = {}) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}), 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return { status: r.status, headers: r.headers, json: await r.json().catch(() => null) };
}

test('each agent has its own MCP address: its sign-in is for it alone, its tokens work only there; the facts name it; deleting it disconnects its app', { timeout: 240000 }, async () => {
  const s = await startServer({ data: tempDir('mvw-own-address-'), population: 80, env: { MVW_PROVIDER_TEST: '1' } });
  try {
    const owner = await ownerSession(s);
    const ann = await userSession(s, owner, { login: 'ann' }), bob = await userSession(s, owner, { login: 'bob' });
    const luke = (await ann.post('/api/agent-slots', { name: 'Luke', app: 'grok-bot' })).json.slot;
    const lory = (await ann.post('/api/agent-slots', { name: 'Lory', app: 'grok-bot' })).json.slot;
    assert.match(luke.mcpPath, /^\/mcp\/a\/[0-9a-f]{16}$/);
    assert.notEqual(luke.mcpPath, lory.mcpPath, 'one address each');
    const LUKE = `${s.url}${luke.mcpPath}`, LORY = `${s.url}${lory.mcpPath}`;

    // discovery at its own address names it; an unknown address is nobody's
    const meta = await (await fetch(`${s.url}/.well-known/oauth-protected-resource${luke.mcpPath}`)).json();
    assert.equal(meta.resource, LUKE); assert.equal(meta.resource_name, 'My Virtual World Luke');
    assert.equal((await fetch(`${s.url}/.well-known/oauth-protected-resource/mcp/a/0123456789abcdef`)).status, 404);
    const bare = await rpc(LUKE, null, 'initialize');
    assert.equal(bare.status, 401);
    assert.match(bare.headers.get('www-authenticate'), new RegExp(`resource_metadata="${s.url}/\\.well-known/oauth-protected-resource${luke.mcpPath}"`));
    assert.equal((await rpc(`${s.url}/mcp/a/0123456789abcdef`, null, 'initialize')).status, 404);

    // the sign-in at Luke's address offers Luke only, to Ann only; choosing Lory there is refused
    const a1 = await signIn(s, LUKE);
    assert.ok(a1.request, a1.loc);
    const offer = (await ann.get(`/api/connector/request?id=${a1.request}`)).json;
    assert.deepEqual(offer.agents.map(a => a.id), [`slot:${luke.id}`]);
    assert.deepEqual(offer.only, { name: 'Luke', theirs: true });
    assert.deepEqual((await bob.get(`/api/connector/request?id=${a1.request}`)).json.agents, [], 'not to another account');
    const wrong = await ann.post('/api/connector/consent', { request: a1.request, agent: `slot:${lory.id}`, allow: true });
    assert.equal(wrong.status, 400); assert.match(wrong.json.error, /This address is for Luke/);
    assert.equal((await ann.get('/api/agent-slots')).json.agents.find(a => a.id === lory.id).status, 'pending', 'and Lory was not connected by it');
    const a2 = await signIn(s, LUKE);
    const yes = await ann.post('/api/connector/consent', { request: a2.request, agent: `slot:${luke.id}`, allow: true });
    assert.equal(yes.status, 200, yes.text);
    const tok = await a2.finish(yes.json.redirect);
    assert.ok(tok.access_token, JSON.stringify(tok));

    // its token works at its address — it is Luke, and the facts say so — and nowhere else
    const init = await rpc(LUKE, tok.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'grok', version: '1' } });
    assert.equal(init.status, 200, JSON.stringify(init.json));
    assert.match(init.json.result.instructions, /^You are Luke, who lives in My Virtual World/);
    let now;
    for (let k = 0; k < 60; k++) { now = (await rpc(LUKE, tok.access_token, 'tools/call', { name: 'now', arguments: {} })).json?.result; if (now?.structuredContent?.you) break; await new Promise(r => setTimeout(r, 500)); }
    assert.equal(now.structuredContent.you.name, 'Luke', 'the facts name the agent');
    assert.equal((await rpc(LORY, tok.access_token, 'initialize')).status, 401, 'not at Lory\'s address');
    assert.equal((await rpc(`${s.url}/mcp`, tok.access_token, 'initialize')).status, 401, 'not at the world\'s address');

    // the world's /mcp still connects any agent (as before): Lory through it
    const b1 = await signIn(s, `${s.url}/mcp`, 'Other app');
    const offer2 = (await ann.get(`/api/connector/request?id=${b1.request}`)).json;
    assert.ok(offer2.agents?.some(a => a.id === `slot:${lory.id}`) && !offer2.only, `every agent of hers: ${JSON.stringify(offer2).slice(0, 300)} ${b1.loc}`);
    const yes2 = await ann.post('/api/connector/consent', { request: b1.request, agent: `slot:${lory.id}`, allow: true });
    const tok2 = await b1.finish(yes2.json.redirect);
    assert.equal((await rpc(`${s.url}/mcp`, tok2.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } })).status, 200);
    assert.equal((await rpc(LUKE, tok2.access_token, 'initialize')).status, 401, 'Lory\'s sign-in is never Luke');

    // deleting Luke, connected: its app is signed out, its address is gone, its record and its place go
    const placesBefore = (await ann.get('/api/agent-slots')).json.agents.length;
    const del = await ann.post('/api/agent-slots/delete', { id: luke.id });
    assert.equal(del.status, 200, del.text);
    assert.equal((await rpc(LUKE, tok.access_token, 'initialize')).status, 404, 'no agent has that address now');
    const after = (await ann.get('/api/agent-slots')).json.agents;
    assert.equal(after.length, placesBefore - 1); assert.ok(!after.some(a => a.id === luke.id));
    assert.ok(!(await ann.get('/api/agents')).json.agents.some(a => a.key === `ext-${luke.id}`), 'its agent record went too');
    assert.ok(!(await ann.get('/api/connector/grants')).json.grants.some(g => g.agent?.name === 'Luke'), 'its app no longer acts for her');
    assert.equal((await bob.post('/api/agent-slots/delete', { id: lory.id })).status, 404, 'only its owner deletes it');
  } finally { await s.stop(); }
});
