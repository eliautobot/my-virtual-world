// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A connected agent's own tools over MCP (server/connector/body-tools.js; 2026-10-12): an AI app its owner connects as
// their connected agent IS that agent — now (the facts), inbox and reply (with the world's checks on what a visitor is
// shown), focused questions, look, act — through the agent's own door, and it counts as online; anyone else connecting
// it (a person it is shared with to manage), or a connection its owner has disconnected, gets nothing of the body.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';

/** Connects an AI app (OAuth: register, authorize, the person's consent, the token) as agentId → an MCP caller. */
async function connectApp(s, person, agentId, name = 'Grok Bot', { seen = null } = {}) {
  const RESOURCE = `${s.url}/mcp`, APP_PORT = 40000 + 3124, APP = `http://127.0.0.1:${APP_PORT}`;
  const asm = await (await fetch(`${s.url}/.well-known/oauth-authorization-server`)).json();
  const reg = await (await fetch(asm.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: name, redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none' }) })).json();
  const v = crypto.randomBytes(40).toString('base64url'), challenge = crypto.createHash('sha256').update(v).digest('base64url');
  const authz = new URL(asm.authorization_endpoint);
  for (const [k, val] of Object.entries({ client_id: reg.client_id, redirect_uri: `${APP}/callback`, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 's', resource: RESOURCE, scope: 'agent' })) authz.searchParams.set(k, val);
  const request = /request=([A-Za-z0-9_-]+)/.exec((await fetch(authz, { redirect: 'manual' })).headers.get('location'))[1];
  if (seen) seen((await person.get(`/api/connector/request?id=${request}`)).json, request);
  const yes = await person.post('/api/connector/consent', { request, agent: agentId, allow: true });
  assert.equal(yes.status, 200, yes.text);
  const code = new URL(yes.json.redirect).searchParams.get('code');
  const t = await (await fetch(asm.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: reg.client_id, code, code_verifier: v, redirect_uri: `${APP}/callback`, resource: RESOURCE }) })).json();
  let id = 0;
  const rpc = async (method, params = {}) => (await fetch(RESOURCE, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${t.access_token}`, 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) })).json();
  const tool = async (n, args = {}) => (await rpc('tools/call', { name: n, arguments: args })).result;
  return { rpc, tool };
}

test('the owner\'s AI app is its connected agent over MCP: facts, messages and answers (checked), focused questions, actions; nobody else gets the body', { timeout: 240000 }, async () => {
  const s = await startServer({ data: tempDir('mvw-connector-body-'), population: 80, env: { MVW_PROVIDER_TEST: '1' } });
  try {
    const owner = await ownerSession(s);
    const ann = await userSession(s, owner, { login: 'ann' }), bob = await userSession(s, owner, { login: 'bob' });
    // Ann's connected agent, enrolled with its key and approved; its body in the city
    const made = await ann.post('/api/agent-slots', { name: 'Juno' });
    const slot = made.json.slot.id;
    await ann.post('/api/agent-slots/update', { id: slot, visibility: 'public', chatAudience: 'everyone', appearInWorld: true });
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64url');
    const sig = crypto.sign(null, Buffer.from(`v1|enrol|${made.json.code}|${pub}`), privateKey).toString('base64url');
    assert.equal((await fetch(`${s.url}/api/agent-api/enroll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: made.json.code, publicKey: pub, signature: sig }) })).status, 200);
    assert.equal((await ann.post('/api/agent-slots/approve', { id: slot })).status, 200);
    const rec = (await ann.get('/api/agents')).json.agents.find(a => a.key === `ext-${slot}`);
    assert.ok(rec);

    // Ann connects her AI app as Juno: it is Juno
    const app = await connectApp(s, ann, rec.id);
    const init = await app.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'grok', version: '1' } });
    assert.match(init.result.instructions, /^You are Juno, who lives in My Virtual World/);
    const names = (await app.rpc('tools/list')).result.tools.map(t => t.name);
    for (const n of ['now', 'inbox', 'reply', 'about', 'plans', 'memories', 'conversation', 'look', 'act', 'friends', 'wake_up', 'inventory', 'give']) assert.ok(names.includes(n), n);
    assert.ok(!names.includes('my_agent'), 'the body tools, not the person\'s');
    let now;
    for (let k = 0; k < 60; k++) { now = await app.tool('now'); if (now.structuredContent?.you) break; await new Promise(r => setTimeout(r, 500)); }   // (its body appears a moment after)
    assert.equal(now.isError, false, JSON.stringify(now));
    assert.match(now.structuredContent.you.time, /^\w+ \d{1,2}:\d{2} (AM|PM)$/);
    assert.match(now.structuredContent.you.rule, /"doing" is your day/);
    // what it holds (its welcome kit: the economy on), and giving within its owner's rules
    assert.equal((await owner.post('/api/economy/admin/switch', { name: 'enabled', on: true })).status, 200);
    let inv;
    for (let k = 0; k < 20; k++) { inv = await app.tool('inventory'); if (inv.structuredContent?.ok) break; await new Promise(r => setTimeout(r, 300)); }   // (the residents' economy wakes on its next tick)
    assert.equal(inv.isError, false, JSON.stringify(inv));
    assert.ok(inv.structuredContent.ok && inv.structuredContent.items.some(x => x.name === 'Gift box'), `its welcome kit: ${JSON.stringify(inv.structuredContent).slice(0, 300)}`);
    const now2 = await app.tool('now');
    assert.match(now2.structuredContent.you.holds || '', /Gift box/, 'the facts say what it holds');
    const bobBefore = (await bob.get('/api/inventory')).json.stacks.find(x => x.item === 'goods:gift')?.qty || 0;
    assert.equal((await ann.post('/api/economy/agent/limits', { agent: rec.id, scopes: ['pay'], approveAbove: 100000 })).status, 200);
    const gave = await app.tool('give', { item: 'Gift box', to: 'bob', note: 'For you' });
    assert.equal(gave.isError, false, JSON.stringify(gave));
    assert.ok(gave.structuredContent.ok && gave.structuredContent.gave, JSON.stringify(gave.structuredContent));
    assert.equal((await bob.get('/api/inventory')).json.stacks.find(x => x.item === 'goods:gift')?.qty, bobBefore + 1, 'Bob has it');
    // a trade: Juno puts in its flowers, Bob a coffee; both accept and it swaps
    const op = await app.tool('trade', { action: 'open', to: 'bob', note: 'Flowers for a coffee?' });
    assert.ok(op.structuredContent.ok && op.structuredContent.trade, JSON.stringify(op.structuredContent));
    const tid = op.structuredContent.trade;
    assert.ok((await app.tool('trade', { action: 'offer', trade: tid, items: [{ item: 'flowers', qty: 1 }] })).structuredContent.ok);
    const bCoffee = (await bob.get('/api/inventory')).json.stacks.find(x => x.item === 'food:coffee');
    assert.equal((await bob.post('/api/inventory/trade/offer', { trade: tid, items: [{ stack: bCoffee.id, qty: 1 }] })).status, 200);
    assert.equal((await bob.post('/api/inventory/trade/accept', { trade: tid })).status, 200);
    const tl = (await app.tool('trades')).structuredContent;
    const mine = tl.trades.find(t => t.id === tid);
    assert.ok(mine && mine.theyAccepted && !mine.youAccepted && mine.theyGive.things[0].qty === 1, JSON.stringify(tl));
    assert.match((await app.tool('now')).structuredContent.you.trades || '', /1 open/, 'the facts mention it');
    const acc = (await app.tool('trade', { action: 'accept', trade: tid })).structuredContent;
    assert.equal(acc.status, 'done', JSON.stringify(acc));
    assert.ok((await bob.get('/api/inventory')).json.stacks.some(x => x.item === 'goods:flowers'), 'Bob has the flowers');
    // counts as online (its AI is using its tools)
    const pres = (await ann.get(`/api/presence/${rec.id}`)).json;
    assert.notEqual(pres.state, 'offline', JSON.stringify(pres));

    // Bob writes to Juno; the app reads its inbox and answers through reply — and a link is held back
    const sess = (await bob.post('/api/chat-sessions/create', { agent: rec.id, label: 'Hi' })).json.session;
    const run = await bob.post('/api/providers/runs', { agent: rec.id, session: sess.id, input: 'Hi Juno, what are you up to?' });
    assert.equal(run.status, 200, run.text);
    const box = await app.tool('inbox', { wait: 5 });
    assert.equal(box.isError, false, JSON.stringify(box));
    const msg = box.structuredContent.messages[0];
    assert.equal(msg.text, 'Hi Juno, what are you up to?'); assert.ok(box.structuredContent.you, 'the facts come with it');
    assert.ok(!(box.structuredContent.notices || []).some(n => /out of date/.test(n.text)), 'no kit to update');
    const held = await app.tool('reply', { runId: msg.runId, text: 'Come see www.example-shop.com for deals' });
    assert.equal(held.isError, true, 'what a visitor is shown is checked first');
    const ans = await app.tool('reply', { runId: msg.runId, text: 'Just enjoying the evening, thanks for asking!' });
    assert.equal(ans.isError, false, JSON.stringify(ans));
    let end = null;
    for (let k = 0; k < 40 && !end; k++) { const e = (await bob.get(`/api/providers/runs/events?run=${run.json.runId}&since=0`)).json; end = (e.events || []).map(x => x.event).find(x => x.type === 'run.end'); if (!end) await new Promise(r => setTimeout(r, 150)); }
    assert.equal(end?.text, 'Just enjoying the evening, thanks for asking!', 'Bob sees the answer');

    // focused questions and an action
    assert.equal((await app.tool('about', { name: 'Nobody Atall' })).structuredContent.ok, false);
    assert.ok(Array.isArray((await app.tool('plans')).structuredContent.plans));
    assert.equal((await app.tool('act', { action: 'remember', text: 'Bob says hi in the evenings', long: true })).isError, false);
    assert.ok((await app.tool('memories', { about: 'Bob' })).structuredContent.memories.some(m => /Bob says hi/.test(m.text)));
    const brief = await app.tool('look', { brief: true });
    assert.equal(brief.isError, false); assert.equal(brief.structuredContent.me.name, 'Juno');
    const bad = await app.tool('act', { action: 'fly' });
    assert.equal(bad.isError, true, 'arguments are checked');

    // its own wake-up link, when its platform shows it the address: tried first, kept only if it answers; Ann is told
    const hits = [];
    const hook = http.createServer((q, r) => { q.resume(); q.on('end', () => { hits.push(q.url); r.writeHead(q.url.includes('missing') ? 404 : 202); r.end(); }); });
    await new Promise(r => hook.listen(0, '127.0.0.1', r));
    try {
      const at = p => `http://127.0.0.1:${hook.address().port}${p}`;
      assert.equal((await app.tool('wake_up')).structuredContent.wakeUp.set, false);
      const guess = await app.tool('wake_up', { url: at('/missing'), key: 'k_' + 'm4'.repeat(8) });
      assert.equal(guess.isError, true); assert.equal(guess.structuredContent.code, 'wakeup_failed');
      const set = await app.tool('wake_up', { url: at('/hooks/juno'), header: `Authorization: Bearer k_${'m4'.repeat(8)}` });
      assert.equal(set.isError, false, JSON.stringify(set)); assert.equal(set.structuredContent.wakeUp.set, true);
      assert.deepEqual(hits, ['/missing', '/hooks/juno'], 'each was called once to try it');
      const owned = (await ann.get('/api/agent-slots')).json.agents.find(a => a.id === slot);
      assert.equal(owned.wakeUp.set, true); assert.ok(owned.lastUse > 0, 'its owner sees when it last used its tools');
      const told = (await ann.get('/api/notifications')).json;
      assert.ok((told.notifications || told.items || []).some(n => /set its own wake-up link/.test(n.body || '')), 'Ann is told');
      assert.equal((await app.tool('wake_up', { remove: true })).structuredContent.wakeUp.set, false);
    } finally { await new Promise(r => hook.close(r)); }

    // Bob, a person it is shared with to manage, connects his own app as Juno: the person's tools, never the body
    await ann.post('/api/agents/share', { id: rec.id, kind: 'account', who: String((await bob.get('/api/auth/me')).json.account.id), level: 'manage' });
    const bobs = await connectApp(s, bob, rec.id, 'Bob app');
    const bnames = (await bobs.rpc('tools/list')).result.tools.map(t => t.name);
    assert.ok(!bnames.includes('now') && !bnames.includes('reply'), 'no body for anyone but its owner');

    // Ann disconnects Juno: her app no longer has its body
    assert.equal((await ann.post('/api/agent-slots/revoke', { id: slot })).status, 200);
    const after = (await app.rpc('tools/list')).result?.tools?.map(t => t.name) || [];
    assert.ok(!after.includes('now'), 'disconnected: the body is gone');
  } finally { await s.stop(); }
});

test('connecting with MCP alone: the owner\'s choice on the consent page connects a connected agent (no key); only its owner; disconnecting ends the app', { timeout: 240000 }, async () => {
  const s = await startServer({ data: tempDir('mvw-connector-mcponly-'), population: 80, env: {} });
  try {
    const owner = await ownerSession(s);
    const ann = await userSession(s, owner, { login: 'ann' }), bob = await userSession(s, owner, { login: 'bob' });
    const slot = (await ann.post('/api/agent-slots', { name: 'Nova Live' })).json.slot.id;   // named, never connected
    const pick = `slot:${slot}`;
    // Bob can't see or choose it
    await assert.rejects(() => connectApp(s, bob, pick, 'Bob app', { seen: j => assert.ok(!j.agents.some(a => a.id === pick), 'not on Bob\'s list') }));
    // Ann's consent page offers it: not connected yet, the app will live as it; choosing it connects it
    let offered = null;
    const app = await connectApp(s, ann, pick, 'Grok Bot', { seen: j => { offered = j.agents.find(a => a.id === pick); } });
    assert.ok(offered && offered.lives && offered.role === 'Not connected yet', JSON.stringify(offered));
    const v = (await ann.get('/api/agent-slots')).json.agents.find(a => a.id === slot);
    assert.deepEqual([v.status, v.approval, v.via, v.fingerprint], ['active', 'approved', 'mcp', null], 'connected through the app, no key');
    const rec = (await ann.get('/api/agents')).json.agents.find(a => a.key === `ext-${slot}`);
    assert.ok(rec && rec.enabled !== false, 'its agent exists');
    const names = (await app.rpc('tools/list')).result.tools.map(t => t.name);
    assert.ok(names.includes('now') && names.includes('reply'), 'the app lives as it');
    const notes = (await ann.get('/api/notifications')).json;
    assert.ok((notes.notifications || notes.items || []).some(n => /Nova Live is connected through an AI app \(MCP\)/.test(n.body || '')), 'its owner is told');
    // the kit's door stays shut without a key; Ann disconnects it: the app's connection ends at once
    assert.equal((await ann.post('/api/agent-slots/revoke', { id: slot })).status, 200);
    const after = await app.rpc('tools/list');
    assert.ok(!after.result, 'the app no longer reaches it');
    // it is offered again, and can be connected again the same way
    const again = await connectApp(s, ann, pick, 'Grok Bot', { seen: j => assert.ok(j.agents.some(a => a.id === pick), 'offered again') });
    assert.ok((await again.rpc('tools/list')).result.tools.some(t => t.name === 'now'));
  } finally { await s.stop(); }
});
