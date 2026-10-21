// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Approvals in the chat and notifications on a real server (docs/features/CHAT.md §8): its owner asks the agent to buy
// something above the "ask me above" limit - the chat shows the approval (an event while it writes, kept with the
// answer), the bell keeps a notification, the owner approves it through the economy and the purchase happens; an answer
// that comes while the owner has no page open is kept and pushed (encrypted for its browser, decrypted here) to a push
// service on this machine; with a page open it isn't; a device the service says is gone is dropped.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession, httpClient } from './helpers/server.mjs';

const VC = n => n * 100;
let s, owner, ann, fake, pushSvc, A;
const pushed = [];
let pushStatus = 201;
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 10000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(40); } };

/** The fake brain, its owner's chat: coffee → the menu → buy the first item; anything else → "Echo: …". */
function answer(j) {
  const sys = j.messages.find(m => m.role === 'system')?.content || '';
  const users = j.messages.filter(m => m.role === 'user').map(m => m.content), k = users.findLastIndex(u => !/^RESULTS:/.test(u)), msg = users[k], rounds = users.length - 1 - k;
  if (/coffee/.test(msg)) {
    const where = /(?:café|restaurant) «([^»]+)»/.exec(sys)?.[1];
    if (rounds === 0) return JSON.stringify({ use: [{ tool: 'menu', place: where }] });
    if (rounds === 1) return JSON.stringify({ use: [{ tool: 'buy', place: where, items: [{ item: 'I1', n: 1 }] }] });
    return /waiting: my owner must agree/.test(users.at(-1)) ? 'I asked you first - it\'s above your limit.' : 'Bought it.';
  }
  return `Echo: ${msg}`;
}
/** A browser: its keys, and how it decrypts what the push service hands it. */
const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
const authSecret = crypto.randomBytes(16);
function decrypt(body) {
  const salt = body.subarray(0, 16), idlen = body[20], as = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen), ua = ecdh.getPublicKey();
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdh.computeSecret(as), authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32));
  const d = crypto.createDecipheriv('aes-128-gcm', Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)), Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12)));
  d.setAuthTag(ct.subarray(ct.length - 16));
  const p = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return JSON.parse(p.subarray(0, p.length - 1).toString());
}

before(async () => {
  fake = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; });
    req.on('end', () => {
      const j = JSON.parse(b || '{}');
      if (req.url.endsWith('/models')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fake' }] })); return; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ model: 'fake', choices: [{ finish_reason: 'stop', message: { content: answer(j) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
    });
  }).listen(0, '127.0.0.1');
  pushSvc = http.createServer((req, res) => {
    const chunks = []; req.on('data', d => chunks.push(d));
    req.on('end', () => { pushed.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) }); res.statusCode = pushStatus; res.end(); });
  }).listen(0, '127.0.0.1');
  await Promise.all([new Promise(r => fake.on('listening', r)), new Promise(r => pushSvc.on('listening', r))]);
  s = await startServer({ population: 260, agents: 3, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  assert.equal((await owner.post('/api/economy/admin/switch', { name: 'enabled', on: true })).status, 200);
  const agents = (await owner.get('/api/agents')).json.agents;
  for (const a of agents) await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' });
  // (buying in the city is its city self's: its owner's chats here are in Life - docs/features/CHAT.md §13)
  for (const a of agents) assert.equal((await owner.post('/api/agent-work', { agent: a.id, defaultMode: 'life' })).status, 200);
  const brain = (await owner.post('/api/connections', { kind: 'models', label: 'Brain', scope: 'installation', config: { provider: 'custom', baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake' }, secrets: { apiKey: 'k' } })).json.id;
  A = agents[0];
  assert.equal((await owner.post('/api/agents/update', { id: A.id, connectionId: brain, nativeId: 'mind' })).status, 200);
  await owner.post('/api/economy/agent/move', { agent: A.id, dir: 'fund', amount: VC(100) });
  // its owner agrees above 0.01 VC: every purchase waits for the OK
  assert.equal((await owner.post('/api/economy/agent/limits', { agent: A.id, approveAbove: 1, dailyCap: VC(100) })).status, 200);
});
after(async () => { await s?.stop(); fake?.close(); pushSvc?.close(); });

const newChat = async () => (await owner.post('/api/chat-sessions/create', { agent: A.id, label: 'Errands' })).json.session;
async function ask(session, input) {
  const run = (await owner.post('/api/providers/runs', { agent: A.id, session, input })).json.runId;
  const r = await waitFor(async () => { const e = (await owner.get(`/api/providers/runs/events?run=${run}`)).json; return e.done ? e : null; });
  return r.events.map(x => x.event);
}

test('a purchase above its owner\'s limit: an approval in the chat and in the bell, approved, and done', async () => {
  const sess = await newChat();
  const ev = await ask(sess.id, 'Could you get me a coffee?');
  const ap = ev.find(e => e.type === 'approval.requested');
  assert.ok(ap && /^econ:/.test(ap.approvalId), JSON.stringify(ev.map(e => e.type)));
  assert.match(ap.summary, /^Wants to buy .+ \([\d.]+ VC\)$/);
  assert.equal(ev.find(e => e.type === 'run.end').text, 'I asked you first - it\'s above your limit.');
  const h = (await owner.get(`/api/providers/history?agent=${A.id}&session=${sess.id}`)).json.messages;
  assert.deepEqual(h.at(-1).meta.approvals.map(a => a.id), [ap.approvalId], 'kept with the answer');
  const id = ap.approvalId.slice(5);
  assert.equal((await owner.get(`/api/economy/approvals?ids=${id}`)).json.approvals[0].status, 'pending');
  assert.deepEqual((await ann.get(`/api/economy/approvals?ids=${id}`)).json.approvals, [], 'not someone else\'s to see');
  const bell = (await owner.get('/api/notifications')).json;
  const n = bell.notifications.find(x => x.kind === 'approval');
  assert.ok(n && n.link.approval === id && n.link.agent === A.id && /asks for your OK/.test(n.title), JSON.stringify(bell));
  assert.ok(bell.unread >= 1);
  const before = (await owner.get('/api/economy/me')).json.agents.find(x => x.id === A.id).wallet.balance;
  const r = await owner.post('/api/economy/approval/answer', { id, approve: true });
  assert.equal(r.json.approval.status, 'approved', r.text);
  assert.ok((await owner.get('/api/economy/me')).json.agents.find(x => x.id === A.id).wallet.balance < before, 'the purchase happened');
  assert.equal((await owner.get(`/api/economy/approvals?ids=${id}`)).json.approvals[0].status, 'approved');
  const read = await owner.post('/api/notifications/read', { approval: id });
  assert.equal(read.json.unread, bell.unread - 1, 'answered: read');
});

test('an answer that comes while no page is open is kept and pushed, encrypted for the browser; not when a page is open', async () => {
  const key = (await owner.get('/api/notifications/push/key')).json.publicKey;
  assert.equal(Buffer.from(key, 'base64url').length, 65);
  const sub = { endpoint: `http://127.0.0.1:${pushSvc.address().port}/push/abc`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') } };
  assert.equal((await owner.post('/api/notifications/push/subscribe', { subscription: sub, device: 'Chrome on Android' })).json.devices, 1);
  assert.equal((await owner.post('/api/notifications/push/subscribe', { subscription: { ...sub, endpoint: 'https://[fd00::3]/x' } })).json.code, 'bad_subscription', 'not inside');
  const sess = await newChat();
  await ask(sess.id, 'hello while away');
  const p = await waitFor(() => pushed.find(x => x.url === '/push/abc'), 5000);
  assert.ok(p, 'pushed');
  assert.equal(p.headers['content-encoding'], 'aes128gcm'); assert.equal(p.headers.ttl, '86400');
  assert.match(p.headers.authorization, new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${key}$`));
  assert.deepEqual(decrypt(p.body), { title: `${A.name} answered`, body: 'Echo: hello while away', url: `/?chat=${A.id}:${sess.id}`, tag: `chat:${A.id}:${sess.id}` });
  assert.ok((await owner.get('/api/notifications')).json.notifications.some(n => n.kind === 'chat' && n.link.session === sess.id), 'kept for the bell');
  // a page open: told on the page, not pushed, not kept
  const ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: owner.cookie } });
  await new Promise(r => { ws.onopen = r; });
  const n0 = pushed.length;
  await ask(sess.id, 'hello while here');
  await wait(300);
  assert.equal(pushed.length, n0, 'not pushed');
  assert.ok(!(await owner.get('/api/notifications')).json.notifications.some(n => n.kind === 'chat' && /here/.test(n.body)));
  ws.close(); await wait(200);
  // the test push, and a device the service says is gone
  assert.equal((await owner.post('/api/notifications/push/test', {})).json.sent, 1);
  pushStatus = 410;
  assert.equal((await owner.post('/api/notifications/push/test', {})).json.sent, 0);
  assert.equal((await owner.get('/api/notifications')).json.devices, 0, 'dropped');
  assert.equal((await ann.get('/api/notifications')).json.notifications.length, 0, 'nothing of another account');
});

test('signing out ends this browser\'s notifications; signing out everywhere ends every device\'s', async () => {
  pushStatus = 201;
  const cara = await userSession(s, owner, { login: 'cara', displayName: 'Cara', role: 'member' });
  const phone = httpClient(s.url); await phone.signIn('cara', cara.password); await phone.get('/api/auth/me');
  const keys = { p256dh: ecdh.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') };
  const at = p => `http://127.0.0.1:${pushSvc.address().port}/push/${p}`;
  assert.equal((await cara.post('/api/notifications/push/subscribe', { subscription: { endpoint: at('laptop'), keys } })).json.devices, 1);
  assert.equal((await phone.post('/api/notifications/push/subscribe', { subscription: { endpoint: at('phone'), keys } })).json.devices, 2);
  // the laptop signs out (its page sends its own push address): only the phone is told now
  assert.equal((await cara.post('/api/auth/signout', { endpoint: at('laptop') })).status, 200);
  assert.equal((await phone.get('/api/notifications')).json.devices, 1);
  const n0 = pushed.length;
  assert.equal((await phone.post('/api/notifications/push/test', {})).json.sent, 1);
  assert.deepEqual(pushed.slice(n0).map(p => p.url), ['/push/phone']);
  // another account's address in a sign-out changes nothing of theirs
  const ann2 = httpClient(s.url); await ann2.signIn('ann', ann.password); await ann2.get('/api/auth/me');
  assert.equal((await ann2.post('/api/auth/signout', { endpoint: at('phone') })).status, 200);
  assert.equal((await phone.get('/api/notifications')).json.devices, 1);
  // signed out everywhere: no device of the account is told any more
  assert.equal((await phone.post('/api/auth/signout', { everywhere: true })).status, 200);
  const again = httpClient(s.url); await again.signIn('cara', cara.password);
  assert.equal((await again.get('/api/notifications')).json.devices, 0);
});
