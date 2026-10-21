// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agent Providers on a real server (docs/features/agent-providers.md): an OpenClaw gateway - a stand-in that runs the
// protocol v4 handshake with OpenClaw's recorded frames and checks the device signature for real
// (tests/helpers/fake-openclaw.mjs) - connected through the provider helper: silent pairing and the hand-off to the
// device's own token, pairing that waits for approval and goes on by itself, a wrong token, chat-only access, the address
// rules, a dropped connection, the provider's agents as agents here, removal (the device takes itself off the gateway),
// and credentials that never come back.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { WebSocketServer } from 'ws';
import { startServer, ownerSession, userSession, httpClient } from './helpers/server.mjs';
import { startFakeOpenClaw } from './helpers/fake-openclaw.mjs';
import { probe } from '../server/providers/openclaw/adapter.js';

let s, owner, ann, gw;
const sleep = ms => new Promise(r => setTimeout(r, ms));
before(async () => {
  gw = await startFakeOpenClaw({ token: 'gw-SECRET-token-1', agents: [{ id: 'main', name: 'Main', emoji: '🦞' }, { id: 'helper', name: 'Helper' }] });
  s = await startServer({ population: 150 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
});
after(async () => { await s?.stop(); await gw?.stop(); });

/** The provider's view once its state is `state` (and, with agents, once that many are listed). */
async function until(c, id, state, { agents = 0, ms = 20000 } = {}) {
  const end = Date.now() + ms;
  let p = null;
  while (Date.now() < end) {
    p = (await c.get('/api/agent-providers')).json.providers.find(x => x.id === id);
    if (p && p.status && p.status.state === state && p.agents.length >= agents) return p;
    await sleep(150);
  }
  assert.fail(`provider ${id} never reached ${state} (last: ${JSON.stringify(p && p.status)})`);
}
const add = (c, body) => c.post('/api/connections', { kind: 'openclaw', label: 'OpenClaw', scope: 'installation', ...body });

test('a gateway on this machine pairs silently; the device signs in with its own token and the gateway\'s is forgotten', async () => {
  const c = await add(owner, { config: { url: gw.url }, secrets: { token: gw.token } });
  assert.equal(c.status, 200, c.text);
  const p = await until(owner, c.json.id, 'connected', { agents: 2 });
  assert.match(p.status.detail, /Connected to OpenClaw 2026\.9\.6/);
  assert.equal(p.status.version, '2026.9.6');
  assert.deepEqual(p.agents.map(a => a.name).sort(), ['Helper', 'Main']);
  assert.equal(gw.badSignatures, 0, 'the device signature checks out');
  const first = gw.connects[0];
  assert.equal(first.client.id, 'gateway-client'); assert.equal(first.client.mode, 'ui'); assert.equal(first.client.displayName, 'My Virtual World');
  assert.equal(first.role, 'operator');
  assert.deepEqual(first.scopes, ['operator.read', 'operator.write', 'operator.approvals', 'operator.questions', 'operator.admin'], 'full access: settings too');
  assert.ok(first.caps.includes('tool-events') && !first.caps.includes('inline-widgets'), 'only the capabilities it implements');
  // the hand-off: the gateway's token is no longer stored; the device token stands in
  await sleep(300);
  const view = (await owner.get('/api/connections')).json.connections.find(x => x.id === c.json.id);
  assert.equal(view.paired, true);
  assert.deepEqual(view.secrets, { token: false, password: false }, 'the gateway token was used once, to pair, and forgotten');
  assert.equal(JSON.stringify(view).includes('deviceKey') || JSON.stringify(view).includes('deviceToken'), false);
  // its agents are agents: named by the provider, each with a body in the city
  const ag = (await owner.get('/api/agents')).json.agents.filter(a => a.key.startsWith('prov-'));
  assert.deepEqual(ag.map(a => [a.name, a.i >= 0]).sort(), [['Helper', true], ['Main', true]], 'each lives in the city');
  const main = ag.find(a => a.name === 'Main');
  const ren = await owner.post('/api/agents/update', { id: main.id, name: 'Renamed' });
  assert.equal(ren.status, 400); assert.equal(ren.json.code, 'provider_agent', 'its name is the provider\'s');
  const rm = await owner.post('/api/agents/remove', { id: main.id });
  assert.equal(rm.status, 400); assert.equal(rm.json.code, 'provider_agent'); assert.match(rm.json.error, /to delete it, use Agent Providers → OpenClaw → Agents/);
});

test('after a restart it signs in with the device token alone', async () => {
  const dir = s.data, pw = owner.password, annPw = ann.password, before = gw.connects.length;
  await s.stop({ keepData: true });
  s = await startServer({ data: dir, env: { MVW_KEY_FILE: s.keyFile } });
  owner = httpClient(s.url); await owner.signIn('owner', pw);
  ann = httpClient(s.url); await ann.signIn('ann', annPw);
  const id = (await owner.get('/api/agent-providers')).json.providers[0].id;
  await until(owner, id, 'connected', { agents: 2 });
  const again = gw.connects.slice(before);
  assert.ok(again.length >= 1);
  const last = again[again.length - 1];
  assert.ok(last.auth && last.auth.deviceToken && !last.auth.token, 'its own token, not the gateway\'s');
  assert.equal(gw.badSignatures, 0);
});

test('a gateway that wants approval: the request id and the command; approved, it goes on by itself', async () => {
  const g2 = await startFakeOpenClaw({ token: 'gw2-token', pairing: 'approval', agents: [{ id: 'ops', name: 'Ops' }] });
  try {
    const c = await add(owner, { label: 'Remote', config: { url: g2.url }, secrets: { token: g2.token } });
    const w = await until(owner, c.json.id, 'pairing');
    const [requestId] = [...g2.pending.keys()];
    assert.equal(w.status.requestId, requestId);
    assert.match(w.status.fix, new RegExp(`openclaw devices approve ${requestId}`));
    assert.equal(w.agents.length, 0);
    assert.ok(g2.approve(requestId));
    const p = await until(owner, c.json.id, 'connected', { agents: 1, ms: 25000 });
    assert.deepEqual(p.agents.map(a => a.name), ['Ops']);
    await owner.post('/api/connections/remove', { id: c.json.id });
  } finally { await g2.stop(); }
});

test('a wrong token is said plainly, with what to do; nothing is listed', async () => {
  const c = await add(owner, { label: 'Wrong', config: { url: gw.url }, secrets: { token: 'not-the-token' } });
  const p = await until(owner, c.json.id, 'error');
  assert.match(p.status.fix, /token/i);
  assert.equal(p.agents.length, 0);
  const t = await owner.post('/api/connections/test', { id: c.json.id });
  assert.equal(t.json.ok, false); assert.equal(t.json.state, 'error');
  assert.equal(JSON.stringify(t.json).includes('not-the-token'), false, 'the credential never comes back');
  await owner.post('/api/connections/remove', { id: c.json.id });
});

test('chat-only access never asks for the admin scope', async () => {
  const g3 = await startFakeOpenClaw({ token: 'gw3' });
  try {
    const c = await add(owner, { label: 'Chat only', config: { url: g3.url, access: 'chat' }, secrets: { token: g3.token } });
    await until(owner, c.json.id, 'connected', { agents: 1 });
    assert.deepEqual(g3.connects[0].scopes, ['operator.read', 'operator.write', 'operator.approvals', 'operator.questions']);
    await owner.post('/api/connections/remove', { id: c.json.id });
    assert.equal(g3.paired.size, 1, 'without admin it cannot take itself off the gateway (the page says so)');
  } finally { await g3.stop(); }
});

test('a member\'s own provider must be on a public address; finding gateways on this machine is for administrators', async () => {
  const seen = gw.sockets.size, tried = gw.connects.length;
  const c = await ann.post('/api/connections', { kind: 'openclaw', label: 'Mine', config: { url: gw.url }, secrets: { token: gw.token } });
  assert.equal(c.status, 200, c.text);
  assert.equal(c.json.scope, 'account');
  const p = await until(ann, c.json.id, 'error');
  assert.equal(p.status.code, 'address_not_public');
  await sleep(300);
  assert.equal(gw.connects.length, tried, 'it never reached the gateway');
  assert.equal(gw.sockets.size, seen);
  const d = await ann.post('/api/agent-providers/detect', { kind: 'openclaw' });
  assert.equal(d.status, 403);
  const others = (await owner.get('/api/agent-providers')).json.providers.map(x => x.id);
  assert.equal(others.includes(c.json.id), false, 'a member\'s own provider is theirs alone');
  await ann.post('/api/connections/remove', { id: c.json.id });
});

test('a dropped connection says so and comes back by itself', async () => {
  const id = (await owner.get('/api/agent-providers')).json.providers.find(x => x.label === 'OpenClaw').id;
  gw.dropAll();
  await until(owner, id, 'offline', { ms: 10000 });
  await until(owner, id, 'connected', { ms: 20000 });
});

test('the provider\'s agents follow its list: renamed, gone (switched off), back', async () => {
  const id = (await owner.get('/api/agent-providers')).json.providers.find(x => x.label === 'OpenClaw').id;
  gw.agents = [{ id: 'main', name: 'Main Two', emoji: '🦀' }];
  let v = (await owner.post('/api/agent-providers/sync', { id })).json;
  assert.deepEqual(v.agents.map(a => a.name), ['Main Two']);
  const all = (await owner.get('/api/agents')).json.agents.filter(a => a.key.startsWith('prov-'));
  assert.deepEqual(all.map(a => a.name), ['Main Two'], 'Helper is switched off: no longer listed');
  gw.agents = [{ id: 'main', name: 'Main Two' }, { id: 'helper', name: 'Helper' }];
  v = (await owner.post('/api/agent-providers/sync', { id })).json;
  assert.deepEqual(v.agents.map(a => a.name).sort(), ['Helper', 'Main Two']);
  assert.equal((await ann.post('/api/agent-providers/sync', { id })).status, 404, 'only its managers; others are told nothing');
});

test('each agent has its name and emoji as OpenClaw shows them (its IDENTITY.md too, whole) and a body in the city that follows it', async () => {
  const id = (await owner.get('/api/agent-providers')).json.providers.find(x => x.label === 'OpenClaw').id;
  const people = async () => JSON.parse((await owner.get('/api/people')).text);
  const resident = async i => { const r = await people(); return (r.people || r).find(p => p && p.i === i); };
  // an agent defined only by its workspace: no name or emoji in agents.list; its IDENTITY.md has both (a joined emoji)
  // (one with no name anywhere: OpenClaw's generic default gives way to its id)
  gw.agents = [{ id: 'main', name: 'Main' }, { id: 'helper', file: { name: 'Nova', emoji: '🧍‍♂️' } }, { id: 'trainer' }];
  const v = (await owner.post('/api/agent-providers/sync', { id })).json;
  const helper = v.agents.find(a => a.nativeId === 'helper');
  assert.deepEqual([helper.name, helper.emoji], ['Nova', '🧍‍♂️'], 'the name and the whole emoji from its identity');
  assert.equal(v.agents.find(a => a.nativeId === 'trainer').name, 'trainer');
  gw.agents = [{ id: 'main', name: 'Main' }, { id: 'helper', file: { name: 'Nova', emoji: '🧍‍♂️' } }];
  await owner.post('/api/agent-providers/sync', { id });
  const listed = (await owner.get('/api/agents')).json.agents.filter(a => a.key.startsWith('prov-'));
  assert.equal(listed.length, 2);
  for (const a of listed) assert.ok(a.i >= 0, `${a.name} has a body`);
  const nova = listed.find(a => a.name === 'Nova');
  assert.equal(nova.role, 'OpenClaw agent');
  const body = await resident(nova.i);
  assert.equal(body.x, 0, 'living'); assert.equal(body.n, 'Nova'); assert.equal(body.e, '🧍‍♂️', 'its badge');
  assert.match(body.jt, /^OpenClaw agent( at |$)/, 'its job');
  // its owner gives it a role of its own: the body's job follows (and the provider's next listing leaves it be)
  assert.equal((await owner.post('/api/agents/update', { id: nova.id, role: 'Researcher' })).status, 200);
  assert.match((await resident(nova.i)).jt, /^Researcher( at |$)/);
  await owner.post('/api/agent-providers/sync', { id });
  assert.match((await resident(nova.i)).jt, /^Researcher( at |$)/);
  // no longer listed: the body retires; listed again: the same body comes back
  gw.agents = [{ id: 'main', name: 'Main' }];
  await owner.post('/api/agent-providers/sync', { id });
  assert.equal((await resident(nova.i)).x, 1, 'retired while its provider does not list it');
  gw.agents = [{ id: 'main', name: 'Main' }, { id: 'helper', file: { name: 'Nova', emoji: '🧍‍♂️' } }];
  await owner.post('/api/agent-providers/sync', { id });
  const back = (await owner.get('/api/agents')).json.agents.find(a => a.name === 'Nova');
  assert.equal(back.i, nova.i, 'the same body'); assert.equal((await resident(nova.i)).x, 0);
  gw.agents = [{ id: 'main', name: 'Main', emoji: '🦞' }, { id: 'helper', name: 'Helper' }];
  await owner.post('/api/agent-providers/sync', { id });
});

test('Reconnect, switch off and on; credentials never come back nor reach the log', async () => {
  const id = (await owner.get('/api/agent-providers')).json.providers.find(x => x.label === 'OpenClaw').id;
  assert.equal((await owner.post('/api/agent-providers/reconnect', { id })).status, 200);
  await until(owner, id, 'connected');
  await owner.post('/api/connections/update', { id, enabled: false });
  const off = await until(owner, id, 'offline');
  assert.equal(off.enabled, false);
  await owner.post('/api/connections/update', { id, enabled: true });
  await until(owner, id, 'connected');
  const bad = await owner.post('/api/connections/update', { id, secrets: { deviceKey: 'x' } });
  assert.equal(bad.status, 400, 'the device key is the server\'s alone');
  for (const p of ['/api/agent-providers', '/api/connections', '/api/providers']) {
    const t = (await owner.get(p)).text;
    assert.equal(/gw-SECRET|BEGIN PRIVATE KEY|"dt-[0-9a-f]+/.test(t), false, `nothing secret in ${p}`);
  }
  assert.equal(/gw-SECRET|BEGIN PRIVATE KEY|dt-[0-9a-f]{24}/.test(s.log()), false, 'nothing secret in the log');
});

test('removing it takes its device off the gateway and its agents out of the chat window', async () => {
  const id = (await owner.get('/api/agent-providers')).json.providers.find(x => x.label === 'OpenClaw').id;
  const dev = gw.connects[gw.connects.length - 1].device.id;
  assert.ok(gw.paired.has(dev));
  const r = await owner.post('/api/agent-providers/remove', { id });
  assert.equal(r.status, 200); assert.deepEqual(r.json, { removed: id, unpaired: true }, 'it says the device left the gateway once it has');
  assert.equal(gw.paired.has(dev), false, 'device.pair.remove of its own device, before the answer');
  assert.ok(gw.requests.some(x => x.method === 'device.pair.remove' && x.params.deviceId === dev));
  assert.equal((await owner.get('/api/agents')).json.agents.some(a => a.key.startsWith('prov-')), false);
});

test('finding a gateway: it answers with connect.challenge; anything else is not one', async () => {
  assert.equal(await probe(gw.url), true);
  const other = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise(r => other.once('listening', r));
  other.on('connection', ws => ws.send(JSON.stringify({ hello: 'not a gateway' })));
  try { assert.equal(await probe(`ws://127.0.0.1:${other.address().port}`), false); }
  finally { await new Promise(r => other.close(r)); }
  assert.equal(await probe('ws://127.0.0.1:9'), false, 'nothing listening');
});

test('the sub-menu: its managers only, its listed calls only, never a secret\'s value; changes guarded and audited', async () => {
  const g4 = await startFakeOpenClaw({ token: 'gw4-token', agents: [{ id: 'main', name: 'Main' }] });
  try {
    const c = await add(owner, { label: 'Menu', config: { url: g4.url }, secrets: { token: g4.token } });
    await until(owner, c.json.id, 'connected', { agents: 1 });
    const call = (who, method, params) => who.post('/api/agent-providers/call', { id: c.json.id, method, params });
    const info = await call(owner, 'system.info');
    assert.equal(info.status, 200); assert.equal(info.json.machineName, 'fake-host');
    // the config: every secret shown as set, never its value (the gateway's own marks, and names like a key's)
    const cfg = (await call(owner, 'config.get')).json;
    assert.deepEqual(cfg.config.gateway.auth.token, { secret: true, set: true });
    assert.deepEqual(cfg.config.models.providers.stub.apiKey, { secret: true, set: true });
    assert.equal(cfg.config.gateway.port, 18789, 'everything else as it is');
    assert.equal(JSON.stringify(cfg).includes('SECRET'), false);
    const outline = (await call(owner, 'settings.outline')).json;
    assert.deepEqual(outline.sections.map(x => x.label), ['Gateway', 'Agents', 'Models'], 'OpenClaw\'s own sections, in its order');
    // only the listed calls; only its managers
    const nope = await call(owner, 'update.run', {});
    assert.equal(nope.status, 400); assert.match(nope.json.error, /not in OpenClaw's sub-menu/);
    assert.equal((await call(ann, 'system.info')).status, 404, 'a member who doesn\'t manage it: nothing');
    // a change with the base hash; one against a stale hash refused with OpenClaw's reason
    const ok = await call(owner, 'config.patch', { raw: JSON.stringify({ agents: { defaults: { model: { primary: 'stub/stub-2' } } } }), baseHash: cfg.hash });
    assert.equal(ok.status, 200, ok.text);
    const stale = await call(owner, 'config.patch', { raw: JSON.stringify({ gateway: { port: 1 } }), baseHash: cfg.hash });
    assert.equal(stale.status, 400); assert.match(stale.json.error, /changed since last load/);
    assert.equal(g4.config.gateway.port, 18789, 'nothing of the stale change applied');
    // a plugin switched on agrees to what it declares: the review token travels (not a credential), its readme and where
    // its credentials live do not; without the token OpenClaw refuses
    const insp = (await call(owner, 'plugins.inspect', { pluginId: 'workboard' })).json;
    assert.deepEqual(insp.declared.tools, ['workboard_list', 'workboard_create']);
    assert.equal(insp.reviewToken, `review-workboard-${g4.configRev}`);
    assert.deepEqual(insp.credentials, [{ label: 'Workboard key', status: 'missing', required: true }]);
    assert.equal('overview' in insp, false); assert.equal(JSON.stringify(insp).includes('WORKBOARD_KEY'), false);
    assert.equal((await call(owner, 'plugins.setEnabled', { pluginId: 'workboard', enabled: true })).status, 400);
    assert.equal((await call(owner, 'plugins.setEnabled', { pluginId: 'workboard', enabled: true, acknowledgeCapabilities: { reviewToken: insp.reviewToken } })).status, 200);
    assert.deepEqual(g4.changes.at(-1), { plugin: 'workboard', enabled: true });
    // a new agent made from the sub-menu joins the chat's agents
    assert.equal((await call(owner, 'agents.create', { name: 'Made Here' })).status, 200);
    for (let i = 0; i < 40 && !(await owner.get('/api/agents')).json.agents.some(a => a.name === 'Made Here'); i++) await sleep(100);
    assert.ok((await owner.get('/api/agents')).json.agents.some(a => a.name === 'Made Here'));
    // audited: which call, never what it carried
    const audit = JSON.stringify((await owner.get('/api/audit?group=providers')).json);
    assert.match(audit, /provider\.change/); assert.match(audit, /config\.patch/); assert.match(audit, /plugins\.setEnabled/);
    assert.equal(audit.includes('review-workboard'), false, 'not even the review token');
    assert.equal(audit.includes('stub/stub-2'), false);
    await owner.post('/api/connections/remove', { id: c.json.id });
  } finally { await g4.stop(); }
});
