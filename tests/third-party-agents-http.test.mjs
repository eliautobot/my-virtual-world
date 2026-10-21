// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Third-party agents from ➕ New agent (2026-10-12): an agent made for an app (Grok Bot, OpenAI Dot, Meta Muse) keeps which
// app it is for; the app's sign-in offers it first, and choosing it there connects it as that agent (MCP, no key); one
// that never connected can be removed outright (it gives its plan's place back), one that was connected can't.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';

/** An AI app's OAuth start (register, authorize) → the consent request id, as the app's sign-in link would carry it. */
async function signInRequest(s, appName) {
  const RESOURCE = `${s.url}/mcp`, APP = `http://127.0.0.1:${40000 + 3125}`;
  const asm = await (await fetch(`${s.url}/.well-known/oauth-authorization-server`)).json();
  const reg = await (await fetch(asm.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: appName, redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none' }) })).json();
  const challenge = crypto.createHash('sha256').update(crypto.randomBytes(40).toString('base64url')).digest('base64url');
  const authz = new URL(asm.authorization_endpoint);
  for (const [k, v] of Object.entries({ client_id: reg.client_id, redirect_uri: `${APP}/callback`, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 's', resource: RESOURCE })) authz.searchParams.set(k, v);
  return /request=([A-Za-z0-9_-]+)/.exec((await fetch(authz, { redirect: 'manual' })).headers.get('location'))[1];
}

test('a third-party agent: made for its app, offered first at the app\'s sign-in, connected by choosing it; removing one that never connected', { timeout: 180000 }, async () => {
  const s = await startServer({ data: tempDir('mvw-third-party-'), population: 60, env: {} });
  try {
    const owner = await ownerSession(s);
    const ann = await userSession(s, owner, { login: 'ann' });

    // the app it is for is kept and shown; an unknown app is refused
    const bad = await ann.post('/api/agent-slots', { name: 'Zed', app: 'not-an-app' });
    assert.equal(bad.status, 400); assert.equal(bad.json.code, 'bad_app');
    const older = (await ann.post('/api/agent-slots', { name: 'Older' })).json.slot;
    const made = await ann.post('/api/agent-slots', { name: 'Nova', app: 'grok-bot' });
    assert.equal(made.status, 200, made.text);
    assert.equal(made.json.slot.app, 'grok-bot');
    assert.equal((await ann.get('/api/agent-slots')).json.agents.find(a => a.id === made.json.slot.id).app, 'grok-bot');

    // the app's sign-in: the newest agent waiting for an app comes first (preselected on the page), with its app
    const request = await signInRequest(s, 'Grok Bot');
    const offer = (await ann.get(`/api/connector/request?id=${request}`)).json;
    assert.equal(offer.agents[0].id, `slot:${made.json.slot.id}`, 'Nova first');
    assert.equal(offer.agents[0].app, 'grok-bot');
    assert.ok(offer.agents.some(a => a.id === `slot:${older.id}`), 'the older one is offered too');

    // choosing it connects it: no key, through the app (MCP), its own agent record, on
    const yes = await ann.post('/api/connector/consent', { request, agent: `slot:${made.json.slot.id}`, allow: true });
    assert.equal(yes.status, 200, yes.text);
    const nova = (await ann.get('/api/agent-slots')).json.agents.find(a => a.id === made.json.slot.id);
    assert.deepEqual([nova.status, nova.approval, nova.via, nova.app], ['active', 'approved', 'mcp', 'grok-bot']);
    const rec = (await ann.get('/api/agents')).json.agents.find(a => a.key === `ext-${made.json.slot.id}`);
    assert.ok(rec && rec.enabled !== false, 'its agent record is on: its Studio opens');

    // a connected one is not removed (disconnect it instead); one that never connected is, with its record
    const no = await ann.post('/api/agent-slots/remove', { id: made.json.slot.id });
    assert.equal(no.status, 409); assert.equal(no.json.code, 'was_connected');
    await ann.post('/api/agent-slots/update', { id: older.id, visibility: 'friends' });   // (a settings change gives it a disabled record)
    const gone = await ann.post('/api/agent-slots/remove', { id: older.id });
    assert.equal(gone.status, 200, gone.text);
    assert.equal((await ann.get('/api/agent-slots')).json.agents.some(a => a.id === older.id), false);
    assert.equal((await ann.get('/api/agents')).json.agents.some(a => a.key === `ext-${older.id}`), false, 'its record went with it');

    // only its owner removes it
    const bob = await userSession(s, owner, { login: 'bob' });
    const mine = (await ann.post('/api/agent-slots', { name: 'Lumen', app: 'grok-bot' })).json.slot;
    assert.equal((await bob.post('/api/agent-slots/remove', { id: mine.id })).status, 404);
  } finally { await s.stop(); }
});

test('who may choose each app in New agent: Grok Bot everyone, Meta Muse admins only, OpenAI Dot no one - the admin\'s setting', { timeout: 180000 }, async () => {
  const s = await startServer({ data: tempDir('mvw-app-offer-'), population: 60, env: {} });
  try {
    const owner = await ownerSession(s);
    const ann = await userSession(s, owner, { login: 'ann' });
    const offered = async who => (await who.get('/api/agent-slots')).json.apps;

    // by default: a member sees Grok Bot only; the owner (an admin) sees Meta Muse too, marked as for admins
    assert.deepEqual(await offered(ann), [{ id: 'grok-bot', offer: 'everyone' }]);
    assert.deepEqual(await offered(owner), [{ id: 'grok-bot', offer: 'everyone' }, { id: 'meta-muse', offer: 'admins' }]);
    for (const app of ['meta-muse', 'openai-dot']) {
      const no = await ann.post('/api/agent-slots', { name: `Try ${app}`, app });
      assert.equal(no.status, 403, app); assert.equal(no.json.code, 'app_not_offered');
    }
    const muse = await owner.post('/api/agent-slots', { name: 'Muse', app: 'meta-muse' });
    assert.equal(muse.status, 200, muse.text);
    assert.equal((await owner.post('/api/agent-slots', { name: 'Dot', app: 'openai-dot' })).json.code, 'app_not_offered');
    // (an agent for no app in particular - Advanced connection - is not affected)
    assert.equal((await ann.post('/api/agent-slots', { name: 'Own program' })).status, 200);

    // the settings, with their words for each choice; a member cannot change them
    const view = (await owner.get('/api/settings')).json.settings.find(x => x.path === 'agentApps.openaiDot');
    assert.deepEqual([view.value, view.values, view.valueLabels.admins], ['off', ['everyone', 'admins', 'off'], 'Admins only (for testing)']);
    assert.equal((await ann.post('/api/settings', { values: { 'agentApps.openaiDot': 'everyone' } })).status, 403);
    assert.equal((await owner.post('/api/settings', { values: { 'agentApps.openaiDot': 'anyone' } })).status, 400);

    // the admin opens OpenAI Dot to everyone and closes Meta Muse: it changes at once; the Muse agent made earlier stays
    const set = await owner.post('/api/settings', { values: { 'agentApps.openaiDot': 'everyone', 'agentApps.metaMuse': 'off' } });
    assert.equal(set.status, 200, set.text);
    assert.deepEqual((await offered(ann)).map(a => a.id), ['grok-bot', 'openai-dot']);
    assert.deepEqual((await offered(owner)).map(a => a.id), ['grok-bot', 'openai-dot']);
    assert.equal((await ann.post('/api/agent-slots', { name: 'Dot', app: 'openai-dot' })).status, 200);
    assert.equal((await owner.post('/api/agent-slots', { name: 'Muse two', app: 'meta-muse' })).json.code, 'app_not_offered');
    assert.equal((await owner.get('/api/agent-slots')).json.agents.find(a => a.id === muse.json.slot.id).app, 'meta-muse');
  } finally { await s.stop(); }
});
