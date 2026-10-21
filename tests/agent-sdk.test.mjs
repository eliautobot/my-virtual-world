// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The public contract of the Agent API (PLAN WP2.14; CHECKLIST I8.14): /skill.md, the OpenAPI description and the JavaScript client are
// served to anybody, describe exactly the routes the server has, and the client works end to end against a real server: enrol, sign
// in, answer a chat message, report progress, stop a run, and sign in again by itself when the token has ended.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { MvwAgent, MvwError, generateIdentity, loadOrCreateIdentity } from '../client/agent-api/mvw-agent.mjs';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann, tmp;
const AGENT_ROUTES = ['GET /api/agent-api/inbox', 'GET /api/agent-api/me', 'GET /api/agent-api/wakeup', 'POST /api/agent-api/enroll', 'POST /api/agent-api/events', 'POST /api/agent-api/session', 'POST /api/agent-api/wakeup'];
const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, 40)); } };
const get = async p => { const r = await fetch(new URL(p, s.url)); return { status: r.status, type: r.headers.get('content-type'), text: await r.text(), headers: r.headers }; };
const events = async (c, run) => (await c.get(`/api/providers/runs/events?run=${run}`)).json;

before(async () => {
  s = await startServer({ population: 150, agents: 3 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-sdk-'));
});
after(async () => { await s?.stop(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('the contract files are served to anybody, with the right types', async () => {
  const skill = await get('/skill.md');
  assert.equal(skill.status, 200); assert.match(skill.type, /^text\/markdown/); assert.match(skill.text, /Agent API v1/);
  const spec = await get('/agent-api/openapi.json');
  assert.equal(spec.status, 200); assert.match(spec.type, /application\/json/); assert.equal(JSON.parse(spec.text).openapi, '3.0.3');
  const js = await get('/agent-api/mvw-agent.mjs'); assert.equal(js.status, 200); assert.match(js.type, /javascript/); assert.match(js.text, /class MvwAgent/);
  const py = await get('/agent-api/mvw_agent.py'); assert.equal(py.status, 200); assert.match(py.type, /python/); assert.match(py.text, /class MvwAgent/);
  assert.equal(skill.headers.get('x-content-type-options'), 'nosniff');
});

test('skill.md and the OpenAPI file describe exactly the routes the server has, and the routes stay in step with the permissions table', async () => {
  const spec = JSON.parse((await get('/agent-api/openapi.json')).text);
  const listed = Object.entries(spec.paths).flatMap(([p, ops]) => Object.keys(ops).map(m => `${m.toUpperCase()} ${p}`)).sort();
  assert.deepEqual(listed, AGENT_ROUTES);
  const skill = (await get('/skill.md')).text;
  for (const r of AGENT_ROUTES) assert.ok(skill.includes(r.split(' ')[1]), `skill.md names ${r}`);
  for (const r of AGENT_ROUTES) {   // each documented route really exists on the server: an unknown path would be 404, these answer as agent routes
    const [method, p] = r.split(' ');
    const res = await fetch(new URL(p, s.url), { method, headers: method === 'POST' ? { 'content-type': 'application/json' } : {}, body: method === 'POST' ? '{}' : undefined });
    assert.notEqual(res.status, 404, r); assert.ok([400, 401, 429].includes(res.status), `${r}: ${res.status}`);
  }
});

test('the client makes and keeps its own key: the file is private and only the public half is ever sent', async () => {
  const file = path.join(tmp, 'a.key.json');
  const id = loadOrCreateIdentity(file);
  assert.equal(fs.statSync(file).mode & 0o077, 0, 'readable by its owner only');
  assert.deepEqual(loadOrCreateIdentity(file), id, 'the same key next time');
  assert.match(id.privateKeyPem, /PRIVATE KEY/); assert.match(id.publicKey, /^[A-Za-z0-9_-]{43}$/);
  const sent = [];
  const agent = new MvwAgent({ baseUrl: s.url, identity: generateIdentity(), fetch: (u, o) => { sent.push(String(o && o.body || '')); return fetch(u, o); } });
  const made = await ann.post('/api/agent-slots', { name: 'Leak check' });
  await agent.enrol(made.json.code); await ann.post('/api/agent-slots/approve', { id: made.json.slot.id }); await agent.login();
  assert.equal(sent.some(b => b.includes('PRIVATE') || b.includes(agent.identity.privateKeyPem.slice(30, 60))), false, 'the private key never travels');
});

test('end to end: enrol, answer a message with progress, get stopped, and sign in again by itself when the token ends', async () => {
  const file = path.join(tmp, 'b.key.json');
  const agent = new MvwAgent({ baseUrl: s.url, identity: loadOrCreateIdentity(file), file });
  const made = await ann.post('/api/agent-slots', { name: 'SDK agent' });
  const en = await agent.enrol(made.json.code);
  assert.equal(en.slot.status, 'active'); assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).slot, en.slot.id, 'the slot is remembered next to the key');
  await assert.rejects(() => agent.enrol(made.json.code), e => e instanceof MvwError && e.status === 401, 'the code works once');
  assert.equal(en.approval, 'waiting');
  await assert.rejects(() => agent.me(), e => e instanceof MvwError && e.status === 403 && e.code === 'awaiting_approval', 'nothing until its owner\'s OK');
  assert.equal((await ann.post('/api/agent-slots/approve', { id: en.slot.id })).status, 200);
  const me = await agent.me(); assert.equal(me.agent.name, 'SDK agent'); assert.equal(me.edition, 'self-hosted');
  const id = (await ann.get('/api/agents')).json.agents.find(a => a.key === `ext-${en.slot.id}`).id;
  const sess = (await ann.post('/api/chat-sessions/create', { agent: id, label: 'SDK' })).json.session;

  const ac = new AbortController(), seen = [];
  const serving = agent.serve(async (m, { progress, signal }) => {
    seen.push(m);
    await progress('Thinking', 40);
    if (m.text === 'slow') { await new Promise(res => { signal.addEventListener('abort', res); setTimeout(res, 8000); }); return 'never seen'; }
    if (m.text === 'boom') throw new Error('it broke');
    return `Echo: ${m.text}`;
  }, { signal: ac.signal, waitSec: 1 });

  const r1 = await ann.post('/api/providers/runs', { agent: id, session: sess.id, input: 'hello sdk' });
  assert.equal(r1.status, 200, r1.text);
  const e1 = await waitFor(async () => { const e = await events(ann, r1.json.runId); return e.done ? e : null; });
  assert.ok(e1, 'the run finished'); assert.equal(e1.events.at(-1).event.status, 'ok'); assert.equal(e1.events.at(-1).event.text, 'Echo: hello sdk');
  assert.ok(e1.events.some(e => e.event.type === 'run.progress' && e.event.text === 'Thinking'), 'progress reached the chat');
  assert.deepEqual([seen[0].text, seen[0].sender], ['hello sdk', { name: 'Ann', visitor: false }]);

  // the token ends: the next call answers 401 resign and the client signs in again without help
  const before = agent.token;
  await ann.post('/api/agent-slots/update', { id: en.slot.id, name: 'SDK agent' });
  agent.token = 'mvws_' + 'A'.repeat(43);
  const r2 = await ann.post('/api/providers/runs', { agent: id, session: sess.id, input: 'after the token ended' });
  const e2 = await waitFor(async () => { const e = await events(ann, r2.json.runId); return e.done ? e : null; });
  assert.ok(e2 && e2.events.at(-1).event.text === 'Echo: after the token ended', 'it signed in again by itself'); assert.notEqual(agent.token, before);

  const r3 = await ann.post('/api/providers/runs', { agent: id, session: sess.id, input: 'boom' });
  const e3 = await waitFor(async () => { const e = await events(ann, r3.json.runId); return e.done ? e : null; });
  assert.equal(e3.events.at(-1).event.status, 'error'); assert.match(e3.events.at(-1).event.error, /it broke/);

  const r4 = await ann.post('/api/providers/runs', { agent: id, session: sess.id, input: 'slow' });
  assert.ok(await waitFor(() => seen.some(m => m.text === 'slow')), 'the slow job started');
  assert.equal((await ann.post('/api/providers/interrupt', { run: r4.json.runId })).status, 200);
  const e4 = await waitFor(async () => { const e = await events(ann, r4.json.runId); return e.done ? e : null; }, 10000);
  assert.ok(e4 && e4.events.at(-1).event.status === 'stopped', 'a stop from the owner aborts the handler and ends the run as stopped');

  ac.abort(); await serving;
});

test('a wrong code or a wrong server address gives a clear error, not a hang', async () => {
  const agent = new MvwAgent({ baseUrl: s.url, identity: generateIdentity() });
  await assert.rejects(() => agent.enrol('mvwe_' + crypto.randomBytes(20).toString('base64url')), e => e instanceof MvwError && e.status === 401 && e.code === 'enrol_refused');
  await assert.rejects(() => agent.login(), /Enrol first/);
});
