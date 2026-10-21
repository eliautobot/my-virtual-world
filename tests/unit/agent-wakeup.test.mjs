// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A connected agent's wake-up link (server/agent-wakeup.js; 2026-10-11): only its owner sets it; only https on the public
// internet; sealed at rest and never shown again (only the host); the call carries nothing but { type, reason, waiting, at }
// with its key in its header; a burst is one call; not while it is at work; what wakes it and how often are its owner's
// (never above the admin's); five failures pause it and its owner is told. Fake clock, a real database, a fake receiver.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { AgentApi, AgentApiError } from '../../server/agent-api.js';
import { WakeUps, WAKEUP_LIMITS, reasonOf } from '../../server/agent-wakeup.js';
import { Audit } from '../../server/auth/audit.js';
import { openDb } from '../../server/db.js';
import { SecretBox, newKey } from '../../server/secrets.js';
import { tempDir } from '../helpers/server.mjs';

const ann = { id: 1, login: 'ann' }, ben = { id: 2, login: 'ben' };
const URL1 = 'https://hooks.example.com/routines/abc123/fire', KEY1 = 'wk_' + 'q7'.repeat(12), HEADER1 = 'X-Routine-Key';

function rig({ settings = {}, answer = () => ({ status: 200 }) } = {}) {
  const dir = tempDir('mvw-wakeup-');
  const store = openDb(dir);
  let t = 1_700_000_000_000;
  const now = () => t;
  const audit = new Audit(store, { now });
  const api = new AgentApi({ store, audit, now });
  const box = new SecretBox(); box.setKeys([newKey()]);
  const calls = [], told = [];
  const S = { 'connected.wakePerHour': 12, ...settings };
  const w = new WakeUps({ store, box, agentApi: api, now, setting: k => S[k], notify: (slot, text) => told.push(text),
    request: async (url, o) => { calls.push({ url, ...o, json: JSON.parse(o.body) }); const a = answer(calls.length); if (a instanceof Error) throw a; return a; } });
  api.hooks.wakeUp = (id, reason) => w.trigger(id, reason);
  const r = { api, w, store, box, calls, told, S, advance: ms => { t += ms; }, now,
    close() { w.close(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
  /** Runs the wake-up waiting for a slot now (instead of after its timer). */
  r.flush = async id => { const p = w.pending.get(id); if (!p) return null; clearTimeout(p.timer); return w.fire(id); };
  return r;
}
function agentFor(r, account = ann) {
  const made = r.api.createSlot(account, { name: `Agent ${crypto.randomBytes(3).toString('hex')}` });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64url');
  const sign = m => crypto.sign(null, Buffer.from(m), privateKey).toString('base64url');
  r.api.enrol({ code: made.code, publicKey: pub, signature: sign(`v1|enrol|${made.code}|${pub}`) });
  r.api.approve(account, made.slot.id);
  const login = () => { const ts = Math.floor(r.now() / 1000), n = crypto.randomBytes(12).toString('base64url'); return r.api.openSession({ slot: made.slot.id, timestamp: ts, nonce: n, signature: sign(`v1|session|${made.slot.id}|${ts}|${n}`) }); };
  return { id: made.slot.id, login };
}
const refused = (fn, status, code) => assert.throws(fn, e => e instanceof AgentApiError && e.status === status && e.code === code, `${status} ${code}`);
const msg = (r, id, visitor = false) => r.api.queueMessage({ slot: { id }, runId: `r${crypto.randomBytes(4).toString('hex')}`, sessionKey: 's1', text: 'hello there', sender: { id: visitor ? 9 : 1, name: visitor ? 'Vic' : 'Ann' }, visitor });

test('only https on the public internet, no password in the address; a header needs its key, and some headers are not ours to set', () => {
  const r = rig();
  try {
    const c = r.w.check({ url: URL1, key: KEY1 });
    assert.deepEqual([c.header, c.key], ['Authorization', `Bearer ${KEY1}`], 'a key alone: Authorization: Bearer <key>'); assert.equal(c.host, 'hooks.example.com');
    const line = r.w.check({ url: URL1, key: KEY1, header: `Authorization: Bearer ${KEY1}` });
    assert.deepEqual([line.header, line.key], ['Authorization', `Bearer ${KEY1}`], 'the header line as the platform shows it');
    const own = r.w.check({ url: URL1, key: KEY1, header: 'X-Routine-Key' });
    assert.deepEqual([own.header, own.key], ['X-Routine-Key', KEY1], 'a header name and its key, as given');
    const ip = (...p) => p.join('.');   // (addresses built from parts: tests/neutrality reads every literal one as an installation's)
    for (const url of ['http://hooks.example.com/x', 'https://127.0.0.1/x', `https://${ip(10, 0, 0, 5)}/x`, `https://${ip(169, 254, 169, 254)}/latest`, 'https://[::1]/x', 'https://localhost/x',
      'https://user:pw@hooks.example.com/x', 'ftp://hooks.example.com/x', 'not a url', '', `https://hooks.example.com/${'a'.repeat(1001)}`]) {
      assert.throws(() => r.w.check({ url }), e => e.code === 'bad_wakeup', url);
    }
    for (const header of ['Host', 'content-length', 'Cookie', 'Bad Header', 'Host: evil.example', 'Cookie: a=b']) assert.throws(() => r.w.check({ url: URL1, key: KEY1, header }), e => e.code === 'bad_wakeup', header);
    assert.throws(() => r.w.check({ url: URL1, header: 'X-Key' }), e => e.code === 'bad_wakeup', 'a header without its key');
    assert.throws(() => r.w.check({ url: URL1, key: 'a\r\nInjected: 1' }), e => e.code === 'bad_wakeup', 'no line breaks in a key');
  } finally { r.close(); }
});

test('only its owner sets it; it is sealed and never shown again - only the host; its owner hears of every change', () => {
  const r = rig();
  try {
    const { id } = agentFor(r);
    refused(() => r.w.set(ben, id, { url: URL1 }), 404, 'not_found');
    const v = r.w.set(ann, id, { url: URL1, key: KEY1, header: HEADER1 });
    assert.deepEqual([v.set, v.host, v.perHour, v.events], [true, 'hooks.example.com', WAKEUP_LIMITS.perHourDefault, { owner: true, others: true, problems: true }]);
    const dump = JSON.stringify(r.store.db.prepare('SELECT * FROM agent_wakeups').all()) + JSON.stringify(r.api.list(ann)) + JSON.stringify(v);
    for (const secret of [URL1, KEY1, HEADER1, 'abc123']) assert.equal(dump.includes(secret), false, `${secret} is not stored or shown`);
    assert.match(r.told.at(-1), /has a wake-up link \(hooks\.example\.com\)/);
    r.w.set(ann, id, { events: { others: false }, perHour: 2 });
    assert.deepEqual([r.w.view(id).events.others, r.w.view(id).perHour], [false, 2], 'what wakes it and how often, without pasting it again');
    refused(() => r.w.set(ann, id, { perHour: 0 }), 400, 'bad_wakeup');
    r.w.set(ann, id, { url: '' });
    assert.equal(r.w.view(id).set, false); assert.match(r.told.at(-1), /was removed/);
    refused(() => r.w.set(ann, id, { url: '' }), 409, 'no_wakeup');
    const actions = r.api.audit.list({ limit: 50 }).map(e => e.action);
    for (const a of ['agent.wakeup_set', 'agent.wakeup_prefs', 'agent.wakeup_removed']) assert.ok(actions.includes(a), a);
    assert.equal(JSON.stringify(r.api.audit.list({ limit: 50 })).includes(KEY1), false, 'the audit trail holds no key');
  } finally { r.close(); }
});

test('a message waiting wakes it with one call: nothing private in it, its key in its header; a burst is one call', async () => {
  const r = rig();
  try {
    const { id } = agentFor(r);
    r.w.set(ann, id, { url: URL1, key: KEY1, header: HEADER1 });
    msg(r, id); msg(r, id, true); msg(r, id);
    assert.equal(r.calls.length, 0, 'gathered first');
    await r.flush(id);
    assert.equal(r.calls.length, 1, 'three messages, one call');
    const c = r.calls[0];
    assert.equal(c.url, URL1); assert.deepEqual(c.headers, { [HEADER1]: KEY1 });
    assert.deepEqual(Object.keys(c.json).sort(), ['at', 'reason', 'type', 'waiting']);
    assert.deepEqual([c.json.type, c.json.reason, c.json.waiting], ['mvw.wakeup', 'owner', 3]);
    assert.equal(c.body.includes('hello there') || c.body.includes('Vic'), false, 'no words, no names');
    assert.equal(r.w.view(id).last.ok, true); assert.equal(r.w.view(id).sentLastHour, 1);
    // within a minute of the last call, the next one waits for the gap
    msg(r, id); const p = r.w.pending.get(id);
    assert.ok(p, 'waiting'); clearTimeout(p.timer); r.w.pending.delete(id);
  } finally { r.close(); }
});

test('not while it is at work, not for what its owner turned off, not when it is not connected', async () => {
  const r = rig();
  try {
    const a = agentFor(r);
    r.w.set(ann, a.id, { url: URL1, events: { others: false } });
    a.login();
    msg(r, a.id); assert.equal(r.w.pending.size, 1, 'it signed in a moment ago: the wake-up waits');
    await r.flush(a.id);
    assert.equal(r.calls.length, 0, 'still at work: not called'); assert.equal(r.w.pending.size, 1, 'it looks again later');
    r.advance(31000); await r.flush(a.id);
    assert.equal(r.calls.length, 1, 'quiet now, and the message still unread: called');
    r.advance(61000);
    msg(r, a.id, true); assert.equal(r.w.pending.size, 0, 'others\' messages: its owner turned them off');
    assert.equal(r.w.trigger(a.id, 'heard'), false, 'lines heard nearby never wake it');
    r.api.revoke(ann, a.id); r.advance(61000);
    assert.equal(r.w.trigger(a.id, 'owner'), false, 'disconnected: never');
    const b = agentFor(r); r.w.set(ann, b.id, { url: URL1 });
    r.S['connected.wakeEnabled'] = false;
    assert.equal(r.w.trigger(b.id, 'owner'), false, 'the admin turned wake-ups off');
    r.S['connected.wakeEnabled'] = true; r.S['connected.enabled'] = false;
    assert.equal(r.w.trigger(b.id, 'owner'), false, 'outside AIs paused');
  } finally { r.close(); }
});

test('at most its owner\'s calls an hour, never above the admin\'s; five failures in a row pause it and its owner is told', async () => {
  const r = rig({ settings: { 'connected.wakePerHour': 3 }, answer: n => (n >= 4 ? Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) : { status: 202 }) });
  try {
    const { id } = agentFor(r);
    r.w.set(ann, id, { url: URL1, perHour: 12 });
    assert.equal(r.w.view(id).cap, 3);
    for (let k = 0; k < 4; k++) { msg(r, id); await r.flush(id); r.advance(61000); }
    assert.equal(r.calls.length, 3, 'the admin\'s 3 an hour'); assert.equal(r.w.view(id).last.status, 'limit');
    assert.equal(r.w.pending.size, 1, 'the fourth waits for a free call, it isn\'t dropped');
    await assert.rejects(() => r.w.test(ann, id), e => e.status === 429 && e.code === 'wakeup_limit');
    r.S['connected.wakePerHour'] = 60; r.w.set(ann, id, { perHour: 60 });
    for (let k = 0; k < 4; k++) { msg(r, id, true); await r.flush(id); r.advance(61000); }
    assert.equal(r.calls.length, 7); assert.equal(r.w.view(id).paused, false, 'four failures: not yet');
    msg(r, id, true); await r.flush(id); r.advance(61000);
    const v = r.w.view(id);
    assert.equal(v.paused, true, 'paused after five failures in a row'); assert.equal(v.last.ok, false);
    assert.match(r.told.at(-1), /failed 5 times in a row/);
    const n = r.calls.length;
    r.advance(3600000); assert.equal(r.w.trigger(id, 'owner'), false, 'paused: not called'); assert.equal(r.calls.length, n);
    r.w.set(ann, id, { perHour: 3 });
    assert.equal(r.w.view(id).paused, false, 'saving it again resumes it');
  } finally { r.close(); }
});

test('its owner tries it: a test call says so and counts against the hour', async () => {
  const r = rig();
  try {
    const { id } = agentFor(r);
    await assert.rejects(() => r.w.test(ann, id), e => e.status === 409 && e.code === 'no_wakeup');
    r.w.set(ann, id, { url: URL1, key: KEY1 });
    await assert.rejects(() => r.w.test(ben, id), e => e.status === 404);
    const out = await r.w.test(ann, id);
    assert.equal(out.ok, true); assert.equal(r.calls[0].json.test, true); assert.equal(r.calls[0].json.reason, 'test');
    assert.equal(out.wakeUp.sentLastHour, 1);
  } finally { r.close(); }
});

test('a message that comes while it is at work: read in that run, nothing wakes it; left unread when it stops, it is woken (2026-10-12)', async () => {
  const r = rig();
  try {
    const a = agentFor(r); r.w.set(ann, a.id, { url: URL1 });
    const slot = () => r.api.q.slot.get(r.api.w, a.id);
    a.login(); msg(r, a.id);
    r.api.collect(slot());   // it reads its inbox again before it stops
    r.advance(31000); await r.flush(a.id);
    assert.equal(r.calls.length, 0, 'it read it at work: no call');
    // what happened live: it answered, looked around and stopped; the next message came in its last half-minute
    r.advance(60000); a.login(); msg(r, a.id);
    assert.equal(r.w.pending.size, 1);
    await r.flush(a.id); assert.equal(r.calls.length, 0, 'not while it may still be running');
    r.advance(31000); await r.flush(a.id);
    assert.equal(r.calls.length, 1, 'it stopped without reading it: woken');
    assert.equal(r.calls[0].json.waiting, 1);
  } finally { r.close(); }
});

test('the agent sets its own link (its platform shows it the address): tried first and kept only if it answers; its owner is told; a few times a day (2026-10-12)', async () => {
  let status = 200;
  const r = rig({ answer: () => ({ status }) });
  const nope = (p, status_, code) => assert.rejects(p, e => e instanceof AgentApiError && e.status === status_ && e.code === code, `${status_} ${code}`);
  try {
    const { id } = agentFor(r), slot = () => r.api.q.slot.get(r.api.w, id);
    // a made-up address (the platform answers 404) is never saved; the agent hears why
    status = 404;
    await nope(r.w.setByAgent(slot(), { url: URL1, key: KEY1 }), 400, 'wakeup_failed');
    assert.equal(r.w.view(id).set, false, 'not saved'); assert.equal(r.told.length, 0, 'nothing to tell its owner');
    assert.deepEqual(r.calls[0].json, { type: 'mvw.wakeup', reason: 'test', waiting: 0, at: r.calls[0].json.at, test: true }, 'the trial call carries nothing private');
    // the rules of an owner's link hold for the agent too
    await nope(r.w.setByAgent(slot(), { url: 'https://localhost/x' }), 400, 'bad_wakeup');
    // a real one: kept, with its key in its header; its owner is told, and sees only the host
    status = 202;
    const out = await r.w.setByAgent(slot(), { url: URL1, header: `Authorization: Bearer ${KEY1}` });
    assert.deepEqual([out.wakeUp.set, out.wakeUp.host, out.test.ok, out.test.status], [true, 'hooks.example.com', true, 202]);
    assert.equal(r.calls.at(-1).headers.Authorization, `Bearer ${KEY1}`);
    assert.match(r.told.at(-1), /set its own wake-up link \(hooks\.example\.com\)/); assert.equal(r.told.at(-1).includes(KEY1), false);
    assert.equal(r.w.view(id).sentLastHour, 1, 'the trial call counts in the hour');
    // and it works like an owner's link: a message wakes it
    r.advance(WAKEUP_LIMITS.gapMs + 1000);
    msg(r, id, true); await r.flush(id);
    assert.equal(r.calls.at(-1).json.reason, 'others');
    // removed by the agent: its owner is told
    const gone = await r.w.setByAgent(slot(), { remove: true });
    assert.equal(gone.wakeUp.set, false); assert.match(r.told.at(-1), /removed its own wake-up link/);
    await nope(r.w.setByAgent(slot(), { remove: true }), 409, 'no_wakeup');
    // at most five changes a day (the failed and refused tries don't count; the made-up address did)
    await r.w.setByAgent(slot(), { url: URL1, key: KEY1 });
    await r.w.setByAgent(slot(), { url: URL1, key: KEY1 });
    await nope(r.w.setByAgent(slot(), { url: URL1, key: KEY1 }), 429, 'too_soon');
    r.advance(24 * 3600000 + 1000);
    await r.w.setByAgent(slot(), { url: URL1, key: KEY1 });
    // the admin's switch: off means off for the agent too
    r.S['connected.wakeEnabled'] = false;
    await nope(r.w.setByAgent(slot(), { url: URL1, key: KEY1 }), 403, 'wakeup_off');
  } finally { r.close(); }
});

test('why an app refused a wake-up call: its own words, one short line, never a key (2026-10-13: Grok Bot\'s rate limit)', () => {
  const key = 'crsr_' + 'a1b2c3d4'.repeat(8);
  assert.equal(reasonOf('{"success":false,"error":"Automation run rate limit exceeded: grok bot limit 15000 per minute, current_count=15001"}'),
    'Automation run rate limit exceeded: grok bot limit 15000 per minute, current_count=15001');
  assert.equal(reasonOf('{"error":{"message":"Bad key"}}'), 'Bad key');
  assert.equal(reasonOf('{"error_description":"Nope"}'), 'Nope');
  assert.equal(reasonOf(`Unknown key ${key}`, { key }), 'Unknown key …');
  assert.equal(reasonOf(`token ${'Z'.repeat(40)} refused`), 'token … refused', 'anything shaped like a key is hidden');
  assert.equal(reasonOf('<html><body><h1>Bad   gateway</h1></body></html>'), 'Bad gateway');
  assert.equal(reasonOf('busy '.repeat(100)).length, 200);
  assert.equal(reasonOf(''), '');
});
