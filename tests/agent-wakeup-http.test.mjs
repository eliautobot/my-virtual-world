// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A connected agent's wake-up link over HTTP on a real server (server/agent-wakeup.js, routes.js; 2026-10-11): its owner
// pastes the address, key and header its platform gave; a message for it while it is away calls that address once, with
// nothing but { type, reason, waiting, at } and the key in its header; "Try it now" calls it on demand; nobody else sets,
// reads or tries it; the list shows only the host; its owner hears of each change. A receiver on this machine stands in for
// the platform (MVW_PROVIDER_TEST lets the server call 127.0.0.1 over http; everywhere else only public https).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann, ben, hook;
const S = {}, got = [];
const KEY = 'wk_' + 'z9'.repeat(14), HEADER = 'X-Routine-Key';
const until = async (fn, ms = 10000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, 200)); } };
const notes = async c => { const j = (await c.get('/api/notifications')).json; return j.notifications || j.items || j.list || []; };

before(async () => {
  hook = http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { got.push({ path: req.url, headers: req.headers, body: b }); res.writeHead(req.url.includes('missing') ? 404 : 202); res.end('ok'); }); });
  await new Promise(r => hook.listen(0, '127.0.0.1', r));
  S.url = `http://127.0.0.1:${hook.address().port}/routines/r1/fire`;
  s = await startServer({ population: 120, agents: 2, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  ben = await userSession(s, owner, { login: 'ben', displayName: 'Ben', role: 'member' });
  const made = await ann.post('/api/agent-slots', { name: 'Juno' }); S.slot = made.json.slot.id;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64url');
  const code = made.json.code, sig = crypto.sign(null, Buffer.from(`v1|enrol|${code}|${pub}`), privateKey).toString('base64url');
  S.sign = m => crypto.sign(null, Buffer.from(m), privateKey).toString('base64url');
  const en = await fetch(new URL('/api/agent-api/enroll', s.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, publicKey: pub, signature: sig }) });
  assert.equal(en.status, 200);
  assert.equal((await ann.post('/api/agent-slots/approve', { id: S.slot })).status, 200);
  S.agent = (await ann.get('/api/agents')).json.agents.find(a => a.key === `ext-${S.slot}`).id;
});
after(async () => { await s?.stop(); await new Promise(r => hook?.close(r)); });

test('only its owner sets it; the list shows the host, never the address, key or header; its owner is told', async () => {
  assert.equal((await ben.post('/api/agent-slots/wakeup', { id: S.slot, url: S.url })).status, 404, 'not another account');
  assert.equal((await owner.post('/api/agent-slots/wakeup', { id: S.slot, url: S.url })).status, 404, 'not the installation owner');
  const badUrl = await ann.post('/api/agent-slots/wakeup', { id: S.slot, url: 'http://example.com/hook' });
  assert.equal(badUrl.status, 400); assert.equal(badUrl.json.code, 'bad_wakeup');
  const r = await ann.post('/api/agent-slots/wakeup', { id: S.slot, url: S.url, key: KEY, header: HEADER });
  assert.equal(r.status, 200, r.text); assert.equal(r.json.wakeUp.set, true); assert.match(r.json.wakeUp.host, /^127\.0\.0\.1:\d+$/);
  const list = await ann.get('/api/agent-slots');
  assert.equal(list.json.agents[0].wakeUp.set, true);
  for (const secret of [KEY, HEADER, '/routines/r1/fire']) assert.equal(list.text.includes(secret) || r.text.includes(secret), false, secret);
  assert.equal((await ben.get('/api/agent-slots')).json.agents.length, 0);
  assert.ok((await notes(ann)).some(n => /has a wake-up link/.test(n.body || '')), 'its owner is told');
});

test('a message while it is away calls the link once: nothing but type, reason, waiting and the time, with its key in its header', async () => {
  const sess = (await ann.post('/api/chat-sessions/create', { agent: S.agent, label: 'Hi' })).json.session;
  const run = await ann.post('/api/providers/runs', { agent: S.agent, session: sess.id, input: 'Are you there, Juno? My secret word is tangerine.' });
  assert.equal(run.status, 200, run.text);
  const call = await until(() => got.find(g => g.path === '/routines/r1/fire'));
  assert.ok(call, 'the link was called within a few seconds');
  assert.equal(call.headers['x-routine-key'], KEY); assert.equal(call.headers['user-agent'], 'MyVirtualWorld-WakeUp/1');
  const b = JSON.parse(call.body);
  assert.deepEqual(Object.keys(b).sort(), ['at', 'reason', 'type', 'waiting']); assert.deepEqual([b.type, b.reason, b.waiting], ['mvw.wakeup', 'owner', 1]);
  assert.equal(/tangerine|Juno|Ann/.test(call.body), false, 'no words, no names');
  await new Promise(r => setTimeout(r, 1500));
  assert.equal(got.length, 1, 'once');
  const w = (await ann.get('/api/agent-slots')).json.agents[0].wakeUp;
  assert.equal(w.last.ok, true); assert.equal(w.sentLastHour, 1);
});

test('"Try it now" calls it on demand (only its owner); removing it stops the calls and its owner is told', async () => {
  assert.equal((await ben.post('/api/agent-slots/wakeup/test', { id: S.slot })).status, 404);
  const t = await ann.post('/api/agent-slots/wakeup/test', { id: S.slot });
  assert.equal(t.status, 200, t.text); assert.equal(t.json.ok, true); assert.equal(t.json.status, 202);
  assert.equal(JSON.parse(got.at(-1).body).test, true);
  const prefs = await ann.post('/api/agent-slots/wakeup', { id: S.slot, events: { owner: false }, perHour: 2 });
  assert.equal(prefs.status, 200); assert.deepEqual([prefs.json.wakeUp.events.owner, prefs.json.wakeUp.perHour], [false, 2]);
  const rm = await ann.post('/api/agent-slots/wakeup', { id: S.slot, url: '' });
  assert.equal(rm.status, 200); assert.equal(rm.json.wakeUp.set, false);
  assert.ok((await notes(ann)).some(n => /wake-up link of Juno was removed/.test(n.body || '')));
  const n = got.length;
  const sess = (await ann.post('/api/chat-sessions/create', { agent: S.agent, label: 'Again' })).json.session;
  await ann.post('/api/providers/runs', { agent: S.agent, session: sess.id, input: 'Hello again' });
  await new Promise(r => setTimeout(r, 4500));
  assert.equal(got.length, n, 'removed: not called');
});

test('the agent sets its own link through its door (its platform shows it the address): tried first, kept only if it answers; its owner is told (2026-10-12)', async () => {
  const ts = Math.floor(Date.now() / 1000), nonce = crypto.randomBytes(12).toString('base64url');
  const ses = await (await fetch(new URL('/api/agent-api/session', s.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: S.slot, timestamp: ts, nonce, signature: S.sign(`v1|session|${S.slot}|${ts}|${nonce}`) }) })).json();
  const door = async (method, body) => { const r = await fetch(new URL('/api/agent-api/wakeup', s.url), { method, headers: { authorization: `Bearer ${ses.token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json() }; };
  assert.equal((await door('GET')).json.wakeUp.set, false);
  assert.equal((await ann.post('/api/agent-api/wakeup', { url: S.url })).status, 401, 'a browser session is not the agent');
  const n = got.length;
  const guess = await door('POST', { url: S.url.replace('/routines/', '/missing/'), key: KEY });
  assert.equal(guess.status, 400); assert.equal(guess.json.code, 'wakeup_failed');
  assert.equal((await door('GET')).json.wakeUp.set, false, 'a made-up address is not kept');
  const set = await door('POST', { url: S.url, header: `Authorization: Bearer ${KEY}` });
  assert.equal(set.status, 200, JSON.stringify(set.json)); assert.equal(set.json.wakeUp.set, true); assert.equal(set.json.test.status, 202);
  assert.equal(got.length, n + 2, 'each was called once to try it');
  const trial = got.at(-1);
  assert.equal(trial.headers.authorization, `Bearer ${KEY}`); assert.equal(JSON.parse(trial.body).test, true);
  assert.ok((await notes(ann)).some(x => /Juno set its own wake-up link/.test(x.body || '')), 'its owner is told');
  const mine = (await ann.get('/api/agent-slots')).json.agents[0];
  assert.equal(mine.wakeUp.set, true); assert.ok(mine.lastUse > 0);
  const rm = await door('POST', { remove: true });
  assert.equal(rm.status, 200); assert.equal(rm.json.wakeUp.set, false);
});
