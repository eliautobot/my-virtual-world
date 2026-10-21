// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The chat mailbox of a connected agent (server/agent-api.js; PLAN WP2.14; DECISIONS C125, C129; CHECKLIST I8.14): messages wait up to
// a day, are handed over once, can be taken back, expire with a message to the chat, and the agent can only report on its own runs.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { AGENT_LIMITS, AgentApi, AgentApiError } from '../../server/agent-api.js';
import { openDb } from '../../server/db.js';
import { normalize } from '../../server/providers/bus.js';
import { tempDir } from '../helpers/server.mjs';

const ann = { id: 1, login: 'ann' }, ben = { id: 2, login: 'ben' };
function rig() {
  const dir = tempDir('mvw-agentq-'), store = openDb(dir);
  let t = 1_700_000_000_000;
  const api = new AgentApi({ store, now: () => t });
  const events = [];
  api.deps.emit = raw => { const e = normalize(raw); events.push(e); return e; };   // the real bus rules: whitelisted fields, required fields
  api.deps.connectionOf = () => 7;
  const slotFor = account => {
    const made = api.createSlot(account, { name: `A${crypto.randomBytes(3).toString('hex')}` });
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64url');
    api.enrol({ code: made.code, publicKey: pub, signature: crypto.sign(null, Buffer.from(`v1|enrol|${made.code}|${pub}`), privateKey).toString('base64url') });
    return api.q.slot.get(api.w, made.slot.id);
  };
  return { api, events, slotFor, advance: ms => { t += ms; }, close() { store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const msg = (slot, runId, text = 'hi', o = {}) => ({ slot, runId, sessionKey: 's1', text, sender: { id: 1, name: 'Ann' }, ...o });
const refused = (fn, status, code) => assert.throws(fn, e => e instanceof AgentApiError && e.status === status && (!code || e.code === code));

test('a message is handed over once, with its sender and the run it belongs to; the chat hears the run start', async () => {
  const r = rig();
  try {
    const slot = r.slotFor(ann);
    r.api.queueMessage(msg(slot, 'r1', 'Hello agent', { visitor: true, sender: { id: 2, name: 'Ben' } }));
    const out = await r.api.inbox(slot);
    assert.equal(out.messages.length, 1);
    assert.deepEqual([out.messages[0].runId, out.messages[0].text, out.messages[0].session, out.messages[0].sender], ['r1', 'Hello agent', 's1', { name: 'Ben', visitor: true }]);
    const start = r.events.find(e => e.type === 'run.start');
    assert.ok(start && start.runId === 'r1' && start.agentKey === String(slot.id) && start.connectionId === '7' && start.kind === 'agentapi', 'presence and chat see the run start');
    assert.equal((await r.api.inbox(slot)).messages.length, 0, 'never handed over twice');
  } finally { r.close(); }
});

test('an agent that is offline finds its messages when it comes back; the queue is capped and another agent never gets them', async () => {
  const r = rig();
  try {
    const a = r.slotFor(ann), b = r.slotFor(ben);
    assert.deepEqual(r.api.queueMessage(msg(a, 'r1')), { online: false }, 'nobody has a session: it waits');
    r.advance(6 * 3600000);
    assert.equal((await r.api.inbox(b)).messages.length, 0, 'another agent gets nothing');
    assert.equal((await r.api.inbox(a)).messages.length, 1, 'six hours later it is still there');
    for (let i = 0; i < AGENT_LIMITS.queueMax; i++) r.api.queueMessage(msg(a, `q${i}`));
    refused(() => r.api.queueMessage(msg(a, 'one-more')), 429, 'queue_full');
    assert.ok(r.api.queueMessage(msg(b, 'other')), 'the cap is per agent');
    r.api.revoke(ann, a.id);
    refused(() => r.api.queueMessage(msg(a, 'late')), 409, 'agent_unavailable');
  } finally { r.close(); }
});

test('a message waits up to 24 hours; after that it is dropped and the chat is told nothing was sent (C125)', () => {
  const r = rig();
  try {
    const slot = r.slotFor(ann);
    r.api.queueMessage(msg(slot, 'old'));
    r.advance(AGENT_LIMITS.queueMs - 1000); r.api.sweep();
    assert.equal(r.events.some(e => e.type === 'run.end'), false, 'still inside the day');
    r.advance(2000); r.api.sweep();
    const end = r.events.find(e => e.type === 'run.end' && e.runId === 'old');
    assert.ok(end && end.status === 'error' && /24 hours/.test(end.error), 'the sender is told');
    r.api.sweep(); assert.equal(r.events.filter(e => e.type === 'run.end').length, 1, 'only once');
  } finally { r.close(); }
});

test('stop takes back a message the agent has not fetched; after it was fetched the agent is told to stop the run', async () => {
  const r = rig();
  try {
    const slot = r.slotFor(ann);
    r.api.queueMessage(msg(slot, 'a'));
    assert.deepEqual(r.api.queueStop('a'), { ok: true, taken_back: true });
    assert.equal(r.events.find(e => e.type === 'run.end' && e.runId === 'a').status, 'stopped');
    assert.equal((await r.api.inbox(slot)).messages.length, 0, 'the agent never sees it');
    r.api.queueMessage(msg(slot, 'b')); await r.api.inbox(slot);
    r.api.queueStop('b');
    assert.deepEqual((await r.api.inbox(slot)).stops, ['b']);
    assert.deepEqual(r.api.queueStop('nope'), { ok: true }, 'stopping something that is gone is not an error');
  } finally { r.close(); }
});

test('the agent reports on its own runs only: progress, tools, an approval request, the end; never an approval answer (C129)', async () => {
  const r = rig();
  try {
    const a = r.slotFor(ann), b = r.slotFor(ben);
    r.api.queueMessage(msg(a, 'ra')); await r.api.inbox(a);
    r.api.reportEvent(a, { type: 'run.progress', runId: 'ra', text: 'Thinking', pct: 20 });
    r.api.reportEvent(a, { type: 'tool.start', runId: 'ra', toolId: 't1', name: 'shell', input: 'ls' });
    r.api.reportEvent(a, { type: 'approval.requested', runId: 'ra', approvalId: 'p1', tool: 'shell', summary: 'rm -rf build' });
    const types = r.events.map(e => e.type); for (const t of ['run.progress', 'tool.start', 'approval.requested']) assert.ok(types.includes(t), t);
    refused(() => r.api.reportEvent(a, { type: 'approval.resolved', runId: 'ra', approvalId: 'p1', approved: true }), 400, 'bad_event');
    refused(() => r.api.reportEvent(a, { type: 'provider.disconnected', runId: 'ra' }), 400, 'bad_event');
    refused(() => r.api.reportEvent(b, { type: 'run.progress', runId: 'ra', text: 'hijack' }), 404, 'unknown_run');   // another agent's run is not confirmed
    refused(() => r.api.reportEvent(a, { type: 'run.progress', runId: 'ghost', text: 'x' }), 404, 'unknown_run');
    refused(() => r.api.reportEvent(a, { type: 'tool.start', runId: 'ra' }), 400, 'bad_event');   // missing fields are refused by the bus
    const n = r.events.length;
    r.api.reportEvent(a, { type: 'run.end', runId: 'ra', status: 'ok', text: 'All done' });
    assert.equal(r.events.at(-1).status, 'ok'); assert.equal(r.events.at(-1).text, 'All done');
    refused(() => r.api.reportEvent(a, { type: 'run.progress', runId: 'ra', text: 'late' }), 404, 'unknown_run');
    assert.equal(r.events.length, n + 1, 'nothing after the end');
    // the owner's answer reaches the agent, and reaches the chat as the approval being resolved
    r.api.queueMessage(msg(a, 'rb')); await r.api.inbox(a);
    r.api.queueApproval('rb', 'p2', true);
    assert.deepEqual((await r.api.inbox(a)).approvals, [{ runId: 'rb', approvalId: 'p2', approved: true }]);
    assert.equal(r.events.at(-1).type, 'approval.resolved');
    refused(() => r.api.queueApproval('ghost', 'p', true), 404, 'unknown_run');
  } finally { r.close(); }
});

test('reports are rate limited per agent, and revoking ends the open runs so the chat frees up', async () => {
  const r = rig();
  try {
    const slot = r.slotFor(ann);
    r.api.queueMessage(msg(slot, 'r1')); await r.api.inbox(slot);
    for (let i = 0; i < AGENT_LIMITS.eventsPerMin; i++) r.api.reportEvent(slot, { type: 'run.progress', runId: 'r1', text: String(i) });
    refused(() => r.api.reportEvent(slot, { type: 'run.progress', runId: 'r1', text: 'x' }), 429, 'rate_limited');
    r.advance(61000); r.api.reportEvent(slot, { type: 'run.progress', runId: 'r1', text: 'ok again' });
    r.api.revoke(ann, slot.id);
    const end = r.events.find(e => e.type === 'run.end' && e.runId === 'r1');
    assert.ok(end && end.status === 'interrupted' && /disconnected/.test(end.error));
  } finally { r.close(); }
});

test('a parked long-poll wakes as soon as a message arrives, returns empty after its wait, and gives up when the agent hangs up', async () => {
  const r = rig();
  try {
    const slot = r.slotFor(ann);
    const t0 = Date.now();
    const parked = r.api.inbox(slot, { waitSec: 5 });
    setTimeout(() => r.api.queueMessage(msg(slot, 'wake')), 150);
    const out = await parked;
    assert.equal(out.messages.length, 1); assert.ok(Date.now() - t0 < 3000, 'woken, not timed out');
    const t1 = Date.now();
    assert.deepEqual(await r.api.inbox(slot, { waitSec: 1 }), { messages: [], stops: [], approvals: [] }); assert.ok(Date.now() - t1 >= 900, 'waited');
    let gone = false; setTimeout(() => { gone = true; }, 100);
    r.api.queueMessage(msg(slot, 'kept'));
    const hung = await r.api.inbox(slot, { waitSec: 5, gone: () => gone }); gone = true;
    const after = await r.api.inbox(slot, { waitSec: 0, gone: () => true });
    assert.deepEqual(after, { messages: [], stops: [], approvals: [] }, 'an agent that hung up takes nothing from the queue');
    assert.equal((await r.api.inbox(slot)).messages.length + hung.messages.length, 1, 'the message was not lost');
  } finally { r.close(); }
});

test('an agent that ends a run without a reason or an answer gets an honest line, and what it reported is logged without content (2026-09-29: "interrupted: the provider restarted")', async () => {
  const r = rig(), notes = [];
  r.api.deps.note = line => notes.push(line);
  try {
    const slot = r.slotFor(ann);
    const end = async (runId, body) => { r.api.queueMessage(msg(slot, runId, 'secret question')); await r.api.inbox(slot); r.advance(4000); r.api.reportEvent(slot, { type: 'run.end', runId, ...body }); return r.events.filter(e => e.type === 'run.end').at(-1); };
    const a = await end('r1', { status: 'interrupted' });
    assert.equal(a.status, 'interrupted'); assert.match(a.error, /agent ended the run and gave no reason/); assert.equal(/provider/i.test(a.error), false, 'it must not blame a provider restart');
    const b = await end('r2', { status: 'error', error: '   ' });
    assert.match(b.error, /agent reported an error and gave no reason/);
    const c = await end('r3', { status: 'error', error: 'The tool crashed' });
    assert.equal(c.error, 'The tool crashed', 'a reason the agent gave is kept as it is');
    const d = await end('r4', { status: 'ok', text: 'The answer' });
    assert.deepEqual([d.status, d.text, d.error], ['ok', 'The answer', undefined]);
    // Sam 19:27: a listener sent its own 206-char answer and ended the run 'interrupted'; the answer explains itself, so no default reason is added and it is logged as an answer
    const e = await end('r5', { status: 'interrupted', text: 'Saved. Automatic replies are off.' });
    assert.deepEqual([e.status, e.text, e.error], ['interrupted', 'Saved. Automatic replies are off.', undefined]);
    const f = await end('r6', { status: 'interrupted', error: 'Codex was closed' });
    assert.equal(f.error, 'Codex was closed');
    const log = notes.join('\n');
    assert.match(log, /took 1 message/); assert.match(log, new RegExp(`slot ${slot.id} ended run r1 as interrupted; reason none, answer none, 4 s after it took the message`));
    assert.match(log, /ended run r4 as ok; reason none, answer 10 chars/);
    assert.match(log, /ended run r5 as interrupted; reason none, answer 33 chars/); assert.match(log, /ended run r6 as interrupted; reason given, answer none/);
    assert.equal(/Saved\. Automatic|Codex was closed/.test(log), false, 'the log carries no message content');
    assert.equal(/secret question|The answer|The tool crashed/.test(log), false, 'the log carries no message content');
  } finally { r.close(); }
});
