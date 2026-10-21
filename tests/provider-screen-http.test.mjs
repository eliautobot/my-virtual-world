// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's own screen (docs/features/agent-pc.md §4.2) on a real server, against the stand-in Hermes and its Bot
// Desktop (tests/helpers/fake-hermes.mjs, as Hermes' tools/bot_desktop and display.* calls): its PC and chat say it has
// one; its state; started; one picture of it; the live stream through /api/providers/screen/ws — watching never types,
// taking over does, a person in control is never pictured; closing the viewer hands control back, a dropped link keeps
// it; Hermes' word passes on (4001: the screen stopped); its browser put on it (Hermes' own two settings); a Hermes
// without a Bot Desktop; who may not see it (another member, another site, no session); how many at once.
// The relay's own rules (a public address for a person's own connection, recheck) are tested on it alone below.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';
import { startFakeHermes } from './helpers/fake-hermes.mjs';
import { ScreenRelay } from '../server/providers/screen-relay.js';
import adapter from '../server/providers/hermes/adapter.js';

let s, owner, ann, hm, conn, agent;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000) { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(50); } return v; }
/** The live stream, as a viewer opens it: { ws, got (buffers), closed (a promise of its close code) } — or { refused: status }. */
function stream(c, ag = agent, { origin = s.url, cookie = c?.cookie } = {}) {
  return new Promise(resolve => {
    const ws = new WebSocket(`${s.url.replace(/^http/, 'ws')}/api/providers/screen/ws?agent=${ag}`, { headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) }, perMessageDeflate: false });
    const got = [];
    let closedWith;
    const closed = new Promise(r => { closedWith = r; });
    ws.on('unexpected-response', (req, res) => resolve({ refused: res.statusCode }));
    ws.on('message', d => got.push(Buffer.from(d)));
    ws.on('close', code => closedWith(code));
    ws.on('error', () => {});
    ws.on('open', async () => { await until(() => got.length > 0, 3000); resolve({ ws, got, closed }); });
  });
}
const text = got => Buffer.concat(got).toString();
const screen = (c = owner, ag = agent) => c.get(`/api/providers/screen?agent=${ag}`);
const act = (action, extra = {}, c = owner) => c.post('/api/providers/screen', { agent, action, ...extra });

before(async () => {
  hm = await startFakeHermes({ token: 'hermes-SECRET-session-token' });
  s = await startServer({ population: 150, agents: 1 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  const c = await owner.post('/api/connections', { kind: 'hermes', label: 'Hermes', scope: 'installation', config: { url: hm.url, auth: 'token' }, secrets: { token: hm.token } });
  assert.equal(c.status, 200, c.text);
  conn = c.json.id;
  const p = await until(async () => { const x = (await owner.get('/api/agent-providers')).json.providers.find(y => y.id === conn); return x?.status?.state === 'connected' && x.agents.length >= 2 ? x : null; }, 20000);
  assert.ok(p, 'Hermes connected');
  agent = p.agents.find(a => a.nativeId === 'default').id;
});
after(async () => { await s?.stop(); await hm?.stop(); });

test('a Hermes agent has a screen of its own: its chat says so, its PC shows it in its Browser', async () => {
  const sessions = await owner.post('/api/chat-sessions/create', { agent, label: 'New chat' });
  assert.equal(sessions.status, 200, sessions.text);
  const caps = (await owner.get(`/api/chat/can?agent=${agent}`)).json;
  assert.equal(caps.caps.screen, true, 'the chat window offers the Screen tab');
  const pc = (await owner.get('/api/pc')).json;
  const mine = pc.agents.find(a => a.id === agent);
  assert.ok(mine, 'the Hermes agent is in its owner\'s PC');
  assert.equal(mine.own?.screen, true, 'its PC shows its screen');
});

test('its state; started; one picture of it (a JPEG), none while it is off', async () => {
  let r = await screen();
  assert.equal(r.status, 200, r.text);
  assert.deepEqual({ available: r.json.available, installed: r.json.installed, running: r.json.running, holder: r.json.holder, mine: r.json.mine, browserOnScreen: r.json.browserOnScreen },
    { available: true, installed: true, running: false, holder: 'agent', mine: false, browserOnScreen: false });
  assert.equal(hm.display.calls.at(-1).profile, 'default', 'asked for this agent\'s profile');
  r = await owner.get(`/api/providers/screen/thumb?agent=${agent}`);
  assert.equal(r.status, 204, 'no picture while it is off');
  r = await act('start');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.running, true);
  r = await owner.get(`/api/providers/screen/thumb?agent=${agent}`);
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.equal((await act('dance')).status, 400, 'nothing else');
});

test('live: the stream passes byte for byte; watching never types, taking over does; a person in control is never pictured', async () => {
  const v = await stream(owner);
  assert.ok(v.ws, `opened (${v.refused})`);
  assert.equal(text(v.got), 'RFB 003.008\n', 'Hermes\' screen speaks first');
  v.ws.send(Buffer.from('ping'));
  await until(() => text(v.got).includes('pong'));
  assert.ok(text(v.got).includes('pong'), 'and answers');
  // a large update passes whole (paused and resumed, never dropped)
  v.got.length = 0;
  v.ws.send(Buffer.from('big'));
  await until(() => Buffer.concat(v.got).length >= 2 * 1048576, 10000);
  assert.equal(Buffer.concat(v.got).length, 2 * 1048576);
  assert.equal(hm.display.input.at(-1).passed, false, 'watching: nothing typed reaches it');
  let r = await act('take');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.holder, r.json.mine], ['human', true]);
  v.ws.send(Buffer.from('key-a'));
  await until(() => hm.display.input.some(x => x.bytes === 'key-a'));
  assert.equal(hm.display.input.find(x => x.bytes === 'key-a').passed, true, 'in control: it reaches the screen (the same viewer)');
  assert.equal((await screen()).json.mine, true, 'its state says so');
  assert.equal((await owner.get(`/api/providers/screen/thumb?agent=${agent}`)).status, 204, 'no picture while a person has control');
  // closing the viewer hands control back
  v.ws.close(1000);
  assert.equal(await v.closed, 1000);
  await until(() => hm.display.lease.holder === 'agent');
  assert.equal(hm.display.lease.holder, 'agent', 'control went back to the agent');
});

test('a dropped link keeps control (a person mid-login is not cut off); Hand back gives it back', async () => {
  const v = await stream(owner);
  assert.equal((await act('take')).json.mine, true);
  v.ws.terminate();
  await until(() => hm.display.closes.length && hm.display.streams.size === 0);
  await sleep(100);
  assert.equal(hm.display.lease.holder, 'human', 'still theirs');
  const r = await act('release');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.holder, r.json.mine], ['agent', false]);
  assert.equal((await act('release')).status >= 400, false, 'handing back twice is harmless');
});

test('Hermes\' word passes on: its screen stopped (4001) closes the viewer with the same code', async () => {
  const v = await stream(owner);
  const r = await act('stop');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.running, false);
  assert.equal(await v.closed, 4001);
  assert.equal((await stream(owner)).refused, 502, 'no stream while it is off');
  assert.equal((await act('start')).json.running, true);
});

test('its browser on its screen: Hermes\' own two settings, for this profile only', async () => {
  let r = await act('browser', { on: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.browserOnScreen, true);
  assert.deepEqual([hm.config.browser.headed, hm.config.bot_desktop.auto_start], [true, true]);
  assert.equal(hm.config.model, 'stub-1', 'nothing else of its settings changed');
  r = await act('browser', { on: false });
  assert.equal(r.json.browserOnScreen, false);
  assert.deepEqual([hm.config.browser.headed, hm.config.bot_desktop.auto_start], [false, false]);
});

test('nobody else sees it: another member, another site, no session; a built-in agent has none', async () => {
  const r = await screen(ann);
  assert.ok(r.status === 403 || r.status === 404, `a member who doesn't manage the provider: ${r.status}`);
  assert.ok([403, 404].includes((await ann.post('/api/providers/screen', { agent, action: 'take' })).status));
  assert.ok([403, 404].includes((await ann.get(`/api/providers/screen/thumb?agent=${agent}`)).status));
  const theirs = await stream(ann);
  assert.ok([403, 404].includes(theirs.refused), `nor its stream (${theirs.refused})`);
  assert.equal((await stream(owner, agent, { origin: 'https://evil.example' })).refused, 403, 'another site\'s page');
  assert.equal((await stream(null, agent, { cookie: '' })).refused, 401, 'no session');
  const theProviders = new Set((await owner.get('/api/agent-providers')).json.providers.flatMap(x => x.agents.map(a => a.id)));
  const builtin = (await owner.get('/api/agents')).json.agents.find(a => !theProviders.has(a.id));
  assert.ok(builtin, 'a built-in agent');
  assert.equal((await screen(owner, builtin.id)).status, 400, 'a built-in agent has no screen of this kind');
  assert.ok(!JSON.stringify((await screen()).json).includes('SECRET'), 'never the session token');
});

test('at most a few at once per person', async () => {
  const open = [];
  for (let i = 0; i < 4; i++) { const v = await stream(owner); assert.ok(v.ws, `stream ${i + 1}`); open.push(v); }
  assert.equal((await stream(owner)).refused, 429);
  for (const v of open) v.ws.close(1000);
  await Promise.all(open.map(v => v.closed));
  await sleep(50);
  const again = await stream(owner);
  assert.ok(again.ws, 'one may open again'); again.ws.close(1000);
});

test('a Hermes without a Bot Desktop (older): the panel says so; Chat only access: none of it', async () => {
  hm.noDisplay = true;
  let r = await screen();
  assert.equal(r.status, 200);
  assert.equal(r.json.available, false); assert.match(r.json.reason, /update Hermes/);
  hm.noDisplay = false;
  // (Chat only access: the adapter refuses before it reaches Hermes)
  r = await adapter.screenState({ connectionId: 'x', config: { access: 'chat' } });
  assert.equal(r.available, false); assert.match(r.reason, /Full access/);
  await assert.rejects(adapter.screenAct({ connectionId: 'x', config: { access: 'chat' }, action: 'take' }), e => e.code === 'forbidden');
  await assert.rejects(adapter.screenTicket({ connectionId: 'x', config: { access: 'chat' } }), e => e.code === 'forbidden');
  await assert.rejects(adapter.screenThumb({ connectionId: 'x', config: { access: 'chat' } }), e => e.code === 'forbidden');
});

test('putting its browser on its screen changes Hermes\' settings: a recent password, as its sub-menu\'s changes', async () => {
  const db = new DatabaseSync(path.join(s.data, 'next.db'), { timeout: 5000 });
  try { db.prepare('UPDATE sessions SET auth_at = auth_at - 660000 WHERE account_id = (SELECT id FROM accounts WHERE login = ?)').run(owner.login || 'owner'); } finally { db.close(); }
  const r = await act('browser', { on: true });
  assert.equal(r.status, 403); assert.equal(r.json.code, 'reauth_required');
  assert.equal(hm.config.browser.headed, false, 'nothing changed');
  assert.equal((await act('take')).status, 200, 'watching and taking over need no password');
  assert.equal((await act('release')).status, 200);
});

// ------------------------------------------------------------------------------------------- the relay by itself
async function relayRig(o = {}) {
  const up = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise(r => up.once('listening', r));
  const upCloses = [];
  up.on('connection', ws => { ws.send(Buffer.from('hi')); ws.on('close', c => upCloses.push(c)); });
  const P = { account: { id: 7 }, session: { id: 's1' } };
  const relay = new ScreenRelay({ principal: () => P, originAllowed: () => true, ticketFor: async () => ({ url: `ws://127.0.0.1:${up.address().port}/x`, allowPrivate: true }), ...o });
  const web = http.createServer();
  web.on('upgrade', (req, sock, head) => relay.handle(req, sock, head));
  await new Promise(r => web.listen(0, '127.0.0.1', r));
  const open = () => new Promise(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${web.address().port}/api/providers/screen/ws?agent=3`);
    let codeOf; const closed = new Promise(r => { codeOf = r; });
    ws.on('unexpected-response', (rq, res) => resolve({ refused: res.statusCode }));
    ws.on('message', () => resolve({ ws, closed }));
    ws.on('close', c => codeOf(c)); ws.on('error', () => {});
  });
  return { relay, open, upCloses, stop: async () => { relay.close(); await new Promise(r => web.close(r)); await new Promise(r => up.close(r)); } };
}

test('the relay: a person\'s own connection reaches only a public address (resolved and pinned here)', async () => {
  const seen = [];
  const rig = await relayRig({
    ticketFor: async () => ({ url: 'ws://screen.example.test:9/x', allowPrivate: false }),
    resolve: async h => { seen.push(h); throw Object.assign(new Error('not public'), { code: 'blocked' }); },
  });
  try {
    assert.equal((await rig.open()).refused, 502);
    assert.deepEqual(seen, ['screen.example.test'], 'the address was checked before anything was dialed');
  } finally { await rig.stop(); }
});

test('the relay: someone no longer allowed is cut off (4403), and control goes back (a clean close upstream)', async () => {
  let ok = true;
  const rig = await relayRig({ allowed: () => ok });
  try {
    const v = await rig.open();
    assert.ok(v.ws);
    rig.relay.recheck();
    assert.equal(rig.relay.open.size, 1, 'still allowed: kept');
    ok = false;
    rig.relay.recheck();
    assert.equal(await v.closed, 4403);
    await until(() => rig.upCloses.length);
    assert.equal(rig.upCloses[0], 1000);
  } finally { await rig.stop(); }
});

test('the relay: a refused ticket is refused as such; text frames are not RFB', async () => {
  let rig = await relayRig({ ticketFor: async () => { throw Object.assign(new Error('no'), { status: 403 }); } });
  try { assert.equal((await rig.open()).refused, 403); } finally { await rig.stop(); }
  rig = await relayRig();
  try {
    const v = await rig.open();
    v.ws.send('not binary');
    assert.equal(await v.closed, 1003);
  } finally { await rig.stop(); }
});
