// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agents that connect outbound with a key they hold (server/agent-api.js; PLAN WP2.14; DECISIONS E22, E23, C122 to C130;
// CHECKLIST I8.14, I8.15): enrolment with a one-time code, signed sessions with replay protection, isolation between accounts,
// revoke and re-enrol, visibility and chat audience, refusal limits. Fake clock, a real database, real Ed25519 keys.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { AGENT_LIMITS, AgentApi, AgentApiError, fingerprintOf, publicKeyFrom, verifySignature } from '../../server/agent-api.js';
import { Audit } from '../../server/auth/audit.js';
import { openDb } from '../../server/db.js';
import { tempDir } from '../helpers/server.mjs';

const MIN = 60000;
const ann = { id: 1, login: 'ann' }, ben = { id: 2, login: 'ben' }, cy = { id: 3, login: 'cy' };

function rig({ friends = null } = {}) {
  const dir = tempDir('mvw-agentapi-');
  const store = openDb(dir);
  let t = 1_700_000_000_000;
  const audit = new Audit(store, { now: () => t });
  const api = new AgentApi({ store, audit, now: () => t, friends });
  return {
    api, store, audit, advance: ms => { t += ms; }, secs: () => Math.floor(t / 1000),
    slotRow: id => api.q.slot.get(api.w, id),
    close() { store.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}
function makeAgent() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64url');
  const sign = m => crypto.sign(null, Buffer.from(m), privateKey).toString('base64url');
  return { pub, sign };
}
const enrolBody = (a, code) => ({ code, publicKey: a.pub, signature: a.sign(`v1|enrol|${code}|${a.pub}`) });
const sessionBody = (a, slot, ts, nonce) => ({ slot, timestamp: ts, nonce, signature: a.sign(`v1|session|${slot}|${ts}|${nonce}`) });
const nonce = () => crypto.randomBytes(12).toString('base64url');
const refused = (fn, status, code) => assert.throws(fn, e => e instanceof AgentApiError && e.status === status && (!code || e.code === code), `${status} ${code || ''}`);
/** A slot for ann with an enrolled agent its owner approved; returns everything a test needs. */
function enrolled(r, account = ann, name = 'Claude') {
  const made = r.api.createSlot(account, { name });
  const a = makeAgent();
  r.api.enrol(enrolBody(a, made.code));
  r.api.approve(account, made.slot.id);
  return { a, id: made.slot.id, code: made.code };
}
const login = (r, a, id, ip = '203.0.113.5') => r.api.openSession(sessionBody(a, id, r.secs(), nonce()), { ip });

test('keys: only a 32-byte Ed25519 public key is accepted, and a signature must match the message and the key', () => {
  const a = makeAgent(), b = makeAgent();
  assert.ok(publicKeyFrom(a.pub)); assert.equal(publicKeyFrom(''), null); assert.equal(publicKeyFrom('not a key!'), null);
  assert.equal(publicKeyFrom(Buffer.alloc(31).toString('base64url')), null, 'wrong length');
  const sig = a.sign('hello');
  assert.equal(verifySignature(a.pub, 'hello', sig), true);
  assert.equal(verifySignature(a.pub, 'hello!', sig), false, 'another message');
  assert.equal(verifySignature(b.pub, 'hello', sig), false, 'another key');
  assert.equal(verifySignature(a.pub, 'hello', ''), false); assert.equal(verifySignature(a.pub, 'hello', 'AAAA'), false);
  assert.equal(fingerprintOf(a.pub).length, 64); assert.notEqual(fingerprintOf(a.pub), fingerprintOf(b.pub));
});

test('a slot and its code: the code is shown once and stored only as a hash; names are unique per account; the count is capped per account; countLive counts the installation\'s', () => {
  const r = rig();
  try {
    const made = r.api.createSlot(ann, { name: '  Claude  Code ' });
    assert.match(made.code, /^mvwe_[A-Za-z0-9_-]{20,40}$/); assert.equal(made.slot.name, 'Claude Code'); assert.equal(made.slot.status, 'pending');
    assert.equal(made.codeExpires - r.slotRow(made.slot.id).created, AGENT_LIMITS.codeMs, '15 minutes (C123)');
    assert.deepEqual([made.slot.visibility, made.slot.chatAudience, made.slot.chatPaused, made.slot.appearInWorld], ['hidden', 'owner', false, false], 'private by default (C127)');
    const dump = JSON.stringify(r.store.db.prepare('SELECT * FROM agent_enrol_codes').all());
    assert.equal(dump.includes(made.code), false, 'the code itself is not in the database');
    assert.equal(JSON.stringify(r.api.list(ann)).includes(made.code), false, 'and not in the list');
    refused(() => r.api.createSlot(ann, { name: 'claude code' }), 409, 'name_taken');
    refused(() => r.api.createSlot(ann, { name: '  ' }), 400, 'bad_name');
    assert.ok(r.api.createSlot(ben, { name: 'Claude Code' }), 'another account may use the same name');
    for (let i = 0; i < 19; i++) r.api.createSlot(ann, { name: `A${i}` });
    refused(() => r.api.createSlot(ann, { name: 'one more' }), 409, 'too_many_agents');
    assert.equal(r.api.countLive(), 21, 'every slot not revoked, whoever made it (demo mode counts them as agents)');
  } finally { r.close(); }
});

test('enrolment: the agent proves it holds the private key; a code works once, expires, and cannot be guessed (I8.14)', () => {
  const r = rig();
  try {
    const made = r.api.createSlot(ann, { name: 'Claude' }), a = makeAgent();
    const out = r.api.enrol(enrolBody(a, made.code), { ip: '203.0.113.5' });
    assert.equal(out.slot.status, 'active'); assert.equal(out.fingerprint, fingerprintOf(a.pub));
    assert.equal(r.slotRow(made.slot.id).pubkey, a.pub, 'only the public key is stored');
    refused(() => r.api.enrol(enrolBody(makeAgent(), made.code)), 401, 'enrol_refused');   // the same code again, another agent
    refused(() => r.api.enrol(enrolBody(a, made.code)), 401, 'enrol_refused');

    const m2 = r.api.createSlot(ann, { name: 'Two' }), b = makeAgent(), c = makeAgent();
    refused(() => r.api.enrol({ code: m2.code, publicKey: b.pub, signature: c.sign(`v1|enrol|${m2.code}|${b.pub}`) }), 401, 'enrol_refused');   // signed by a key it does not hold
    refused(() => r.api.enrol({ code: m2.code, publicKey: b.pub, signature: b.sign('v1|enrol|other|' + b.pub) }), 401, 'enrol_refused');
    refused(() => r.api.enrol({ code: m2.code, publicKey: 'junk', signature: b.sign('x') }), 400, 'enrol_refused');
    refused(() => r.api.enrol({ code: 'mvwe_' + 'A'.repeat(27), publicKey: b.pub, signature: b.sign('x') }), 401, 'enrol_refused');
    refused(() => r.api.enrol({ code: 'nonsense', publicKey: b.pub, signature: b.sign('x') }), 401, 'enrol_refused');
    refused(() => r.api.enrol(enrolBody(a, m2.code)), 409, 'enrol_refused');   // one key cannot serve two slots
    assert.equal(r.slotRow(m2.slot.id).status, 'pending', 'the refusals changed nothing');
    r.advance(AGENT_LIMITS.codeMs + 1);
    refused(() => r.api.enrol(enrolBody(b, m2.code)), 401, 'enrol_refused');   // expired
    const fresh = r.api.newEnrolmentCode(ann, m2.slot.id);
    assert.equal(r.api.enrol(enrolBody(b, fresh.code)).slot.status, 'active', 'a new code works');
    refused(() => r.api.enrol(enrolBody(b, m2.code)), 401, 'enrol_refused', 'the old code no longer exists');
  } finally { r.close(); }
});

test('sessions: a signed message opens a 30-minute session; replays, old clocks, wrong keys and wrong slots are refused (I8.14)', () => {
  const r = rig();
  try {
    const { a, id } = enrolled(r);
    const n = nonce(), body = sessionBody(a, id, r.secs(), n);
    const s = r.api.openSession(body, { ip: '203.0.113.5' });
    assert.match(s.token, /^mvws_[A-Za-z0-9_-]{40,60}$/); assert.equal(s.slot, id); assert.equal(s.expires - r.slotRow(id).last_seen, AGENT_LIMITS.sessionMs, '30 minutes (C122)');
    refused(() => r.api.openSession(body), 401, 'resign');   // the very same signed message again
    refused(() => r.api.openSession(sessionBody(a, id, r.secs(), n)), 401, 'resign');   // the same nonce with a fresh timestamp
    assert.ok(r.api.openSession(sessionBody(a, id, r.secs() + 60, nonce())), '60 seconds ahead is allowed (C130)');
    assert.ok(r.api.openSession(sessionBody(a, id, r.secs() - 60, nonce())), '60 seconds behind is allowed');
    refused(() => r.api.openSession(sessionBody(a, id, r.secs() + 61, nonce())), 401, 'resign');
    refused(() => r.api.openSession(sessionBody(a, id, r.secs() - 61, nonce())), 401, 'resign');
    refused(() => r.api.openSession(sessionBody(makeAgent(), id, r.secs(), nonce())), 401, 'resign');   // a key that is not enrolled
    refused(() => r.api.openSession({ ...sessionBody(a, id, r.secs(), nonce()), nonce: 'short' }), 401, 'resign');
    refused(() => r.api.openSession({ ...sessionBody(a, id, r.secs(), nonce()), timestamp: 'now' }), 401, 'resign');
    refused(() => r.api.openSession(sessionBody(a, id + 100, r.secs(), nonce())), 401, 'resign');
    refused(() => r.api.openSession({ ...sessionBody(a, id, r.secs(), nonce()), slot: String(id) }), 401, 'resign');
    // a pending slot has no key, so nobody can sign for it
    const p = r.api.createSlot(ann, { name: 'Pending' });
    refused(() => r.api.openSession(sessionBody(a, p.slot.id, r.secs(), nonce())), 401, 'resign');
  } finally { r.close(); }
});

test('the token finds its agent, expires after 30 minutes, is stored only as a hash, and a made-up token finds nothing', () => {
  const r = rig();
  try {
    const { a, id } = enrolled(r);
    const s = login(r, a, id);
    assert.equal(r.api.authenticate(s.token).id, id);
    assert.equal(JSON.stringify(r.store.db.prepare('SELECT * FROM agent_sessions').all()).includes(s.token), false, 'no token in the database');
    assert.equal(r.api.authenticate(''), null); assert.equal(r.api.authenticate('mvws_' + 'A'.repeat(43)), null); assert.equal(r.api.authenticate(s.token + 'x'), null);
    assert.equal(r.api.authenticate(s.token.replace('mvws_', 'mvwe_')), null);
    r.advance(29 * MIN); assert.equal(r.api.authenticate(s.token).id, id, 'still valid inside 30 minutes');
    r.advance(2 * MIN); assert.equal(r.api.authenticate(s.token), null, 'expired');
    const again = login(r, a, id); assert.equal(r.api.authenticate(again.token).id, id, 'signing again renews it');
  } finally { r.close(); }
});

test('revoke ends the sessions at once; re-enrolling with a new key keeps the slot, its name and its settings; the old key is dead (C124)', () => {
  const r = rig();
  try {
    const { a, id } = enrolled(r);
    r.api.update(ann, id, { visibility: 'friends', chatAudience: 'friends', appearInWorld: true });
    const s1 = login(r, a, id);
    assert.equal(r.api.revoke(ann, id).status, 'revoked');
    assert.equal(r.api.authenticate(s1.token), null, 'the session ended at once');
    refused(() => r.api.openSession(sessionBody(a, id, r.secs(), nonce())), 401, 'resign');
    const again = r.api.newEnrolmentCode(ann, id), b = makeAgent();
    assert.equal(r.slotRow(id).status, 'pending'); assert.equal(r.slotRow(id).pubkey, null);
    const out = r.api.enrol(enrolBody(b, again.code));
    assert.equal(out.slot.id, id, 'the same slot'); assert.equal(out.slot.name, 'Claude');
    assert.deepEqual([out.slot.visibility, out.slot.chatAudience, out.slot.appearInWorld], ['friends', 'friends', true], 'settings kept');
    refused(() => r.api.openSession(sessionBody(a, id, r.secs(), nonce())), 401, 'resign');   // the lost key
    assert.equal(out.approval, 'waiting', 'a new key waits for its owner\'s OK again');
    refused(() => login(r, b, id), 403, 'awaiting_approval');
    r.api.approve(ann, id);
    assert.ok(login(r, b, id), 'the new key works');
    // rotating a working key: a new code and a new enrolment replace the key and end the old sessions
    const s2 = login(r, b, id), c = makeAgent(), rot = r.api.newEnrolmentCode(ann, id);
    r.api.enrol(enrolBody(c, rot.code));
    assert.equal(r.api.authenticate(s2.token), null, 'the old key\'s session ended');
    refused(() => login(r, c, id), 403, 'awaiting_approval'); r.api.approve(ann, id);
    assert.ok(login(r, c, id));
    refused(() => r.api.openSession(sessionBody(b, id, r.secs(), nonce())), 401, 'resign');
  } finally { r.close(); }
});

test('one account never reaches another\'s agents: not to see, change, revoke or enrol them (X11)', () => {
  const r = rig();
  try {
    const { a, id } = enrolled(r, ann);
    const other = enrolled(r, ben, 'Ben\'s agent');
    assert.deepEqual(r.api.list(ann).map(s => s.id), [id]); assert.deepEqual(r.api.list(ben).map(s => s.id), [other.id]); assert.deepEqual(r.api.list(cy), []);
    refused(() => r.api.update(ben, id, { visibility: 'public' }), 404, 'not_found');
    refused(() => r.api.revoke(ben, id), 404, 'not_found');
    refused(() => r.api.newEnrolmentCode(ben, id), 404, 'not_found');
    refused(() => r.api.update(ann, other.id, { name: 'x' }), 404, 'not_found');
    refused(() => r.api.revoke(ann, 99999), 404, 'not_found');
    refused(() => r.api.update(ann, 'abc', { name: 'x' }), 404, 'not_found');
    assert.equal(r.slotRow(id).visibility, 'hidden'); assert.equal(r.slotRow(id).status, 'active', 'nothing changed');
    // a token of ann's agent finds ann's agent only
    const sa = login(r, a, id), sb = login(r, other.a, other.id);
    assert.equal(r.api.authenticate(sa.token).account_id, ann.id); assert.equal(r.api.authenticate(sb.token).account_id, ben.id);
    // ann's agent cannot sign for ben's slot
    refused(() => r.api.openSession(sessionBody(a, other.id, r.secs(), nonce())), 401, 'resign');
  } finally { r.close(); }
});

test('owner settings: visibility, who may chat, pause, appear in the world and the name are checked; nothing else can be set', () => {
  const r = rig();
  try {
    const { id } = enrolled(r);
    const v = r.api.update(ann, id, { visibility: 'public', chatAudience: 'everyone', chatPaused: true, appearInWorld: true, name: '  Ada  ' });
    assert.deepEqual([v.visibility, v.chatAudience, v.chatPaused, v.appearInWorld, v.name], ['public', 'everyone', true, true, 'Ada']);
    refused(() => r.api.update(ann, id, { visibility: 'everyone' }), 400, 'bad_setting');
    refused(() => r.api.update(ann, id, { chatAudience: 'public' }), 400, 'bad_setting');
    refused(() => r.api.update(ann, id, { name: '' }), 400, 'bad_name');
    r.api.createSlot(ann, { name: 'Taken' });
    refused(() => r.api.update(ann, id, { name: 'taken' }), 409, 'name_taken');
    assert.equal(r.api.update(ann, id, { status: 'revoked', pubkey: 'x', account_id: 9 }).status, 'active', 'unknown fields are ignored');
    assert.equal(r.slotRow(id).account_id, ann.id);
    const view = JSON.stringify(r.api.list(ann));
    assert.equal(view.includes('pubkey'), false, 'the list never carries the key'); assert.match(r.api.list(ann)[0].fingerprint, /^[0-9a-f]{16}$/);
  } finally { r.close(); }
});

test('who sees an agent and who may chat with it: hidden, friends, public and owner, friends, everyone, pause (I8.15)', () => {
  const friends = { friendIds: id => new Set(id === ann.id ? [ben.id] : []) };
  const r = rig({ friends });
  try {
    const { id } = enrolled(r);
    const S = () => r.slotRow(id);
    // hidden and owner-only by default
    assert.deepEqual([r.api.canSee(S(), ann.id), r.api.canSee(S(), ben.id), r.api.canSee(S(), cy.id), r.api.canSee(S(), null)], [true, false, false, false]);
    assert.deepEqual([r.api.canChat(S(), ann.id), r.api.canChat(S(), ben.id), r.api.canChat(S(), cy.id), r.api.canChat(S(), null)], [true, false, false, false]);
    r.api.update(ann, id, { visibility: 'friends' });
    assert.deepEqual([r.api.canSee(S(), ben.id), r.api.canSee(S(), cy.id), r.api.canSee(S(), null)], [true, false, false]);
    assert.equal(r.api.canChat(S(), ben.id), false, 'seeing is not chatting: the audience is still owner only');
    r.api.update(ann, id, { chatAudience: 'friends' });
    assert.deepEqual([r.api.canChat(S(), ben.id), r.api.canChat(S(), cy.id)], [true, false]);
    r.api.update(ann, id, { visibility: 'public', chatAudience: 'everyone' });
    assert.deepEqual([r.api.canSee(S(), cy.id), r.api.canSee(S(), null), r.api.canChat(S(), cy.id), r.api.canChat(S(), null)], [true, true, true, false], 'a guest may look but not chat');
    r.api.update(ann, id, { visibility: 'hidden' });
    assert.equal(r.api.canChat(S(), cy.id), false, 'everyone may chat only with an agent they can see');
    r.api.update(ann, id, { visibility: 'public', chatPaused: true });
    assert.deepEqual([r.api.canChat(S(), cy.id), r.api.canChat(S(), ben.id), r.api.canChat(S(), ann.id)], [false, false, true], 'paused: visitors out, the owner in');
    r.api.update(ann, id, { chatPaused: false }); r.api.revoke(ann, id);
    assert.deepEqual([r.api.canSee(S(), cy.id), r.api.canChat(S(), cy.id), r.api.canChat(S(), ann.id), r.api.canSee(S(), ann.id)], [false, false, false, true], 'a revoked agent is seen only by its owner and chats with nobody');
  } finally { r.close(); }
  const nf = rig(); // without a friends store, friends settings never open anything
  try {
    const { id } = enrolled(nf); nf.api.update(ann, id, { visibility: 'friends', chatAudience: 'friends' });
    assert.deepEqual([nf.api.canSee(nf.slotRow(id), ben.id), nf.api.canChat(nf.slotRow(id), ben.id)], [false, false]);
  } finally { nf.close(); }
});

test('too many refused attempts from one address or against one agent are stopped for a while; good ones still count nothing', () => {
  const r = rig();
  try {
    const { a, id } = enrolled(r);
    const ip = '198.51.100.9', bad = makeAgent();
    for (let i = 0; i < AGENT_LIMITS.failMax; i++) refused(() => r.api.openSession(sessionBody(bad, id, r.secs(), nonce()), { ip }), 401, 'resign');
    refused(() => r.api.openSession(sessionBody(a, id, r.secs(), nonce()), { ip }), 429, 'rate_limited');
    refused(() => r.api.openSession(sessionBody(a, id, r.secs(), nonce()), { ip: '198.51.100.10' }), 429, 'rate_limited');   // the agent itself is guarded too
    r.advance(AGENT_LIMITS.failWindowMs + 1000);
    assert.ok(login(r, a, id, ip), 'it works again after the window');
    // enrolment guesses from one address
    for (let i = 0; i < AGENT_LIMITS.failMax; i++) refused(() => r.api.enrol({ code: 'mvwe_' + crypto.randomBytes(20).toString('base64url'), publicKey: bad.pub, signature: bad.sign('x') }, { ip: '198.51.100.20' }), 401);
    refused(() => r.api.enrol({ code: 'mvwe_' + crypto.randomBytes(20).toString('base64url'), publicKey: bad.pub, signature: bad.sign('x') }, { ip: '198.51.100.20' }), 429, 'rate_limited');
  } finally { r.close(); }
});

test('a session from a new address is noticed, not blocked (C126); the address is stored only as a salted hash', () => {
  const r = rig();
  try {
    const { a, id } = enrolled(r);
    assert.equal(login(r, a, id, '203.0.113.5').newAddress, false, 'the first address is the baseline');
    assert.equal(login(r, a, id, '203.0.113.5').newAddress, false);
    assert.equal(login(r, a, id, '203.0.113.99').newAddress, true);
    assert.ok(r.audit.list({ limit: 200 }).some(e => e.action === 'agent.session_new_address'), 'the owner can be told');
    const row = r.slotRow(id);
    assert.equal(row.last_ip_hash.includes('203.0.113'), false); assert.match(row.last_ip_hash, /^[0-9a-f]{32}$/);
  } finally { r.close(); }
});

test('the audit trail records slot, enrolment, refusals, revoke and changes, and never a code, token or key', () => {
  const r = rig();
  try {
    const made = r.api.createSlot(ann, { name: 'Claude' }), a = makeAgent();
    r.api.enrol(enrolBody(a, made.code), { ip: '203.0.113.5' });
    r.api.approve(ann, made.slot.id, { ip: '203.0.113.9' });
    const s = login(r, a, made.slot.id);
    r.api.update(ann, made.slot.id, { visibility: 'public' });
    try { r.api.openSession(sessionBody(makeAgent(), made.slot.id, r.secs(), nonce())); } catch { /* refused */ }
    r.api.revoke(ann, made.slot.id);
    const events = r.audit.list({ limit: 200 }), actions = new Set(events.map(e => e.action));
    for (const x of ['agent.slot_create', 'agent.enrol', 'agent.approve', 'agent.update', 'agent.signature_failed', 'agent.revoke']) assert.ok(actions.has(x), x);
    const dump = JSON.stringify(events);
    for (const secret of [made.code, s.token, a.pub]) assert.equal(dump.includes(secret), false, 'no secret in the audit trail');
    assert.equal(r.audit.verify().ok, true);
  } finally { r.close(); }
});

// ---- taking over someone's agent (2026-10-11): a code someone else saw is worth nothing without its owner's OK
test('a stolen code: the thief\'s key waits for the owner\'s OK and can do nothing; the owner declines and that key is dead', () => {
  const r = rig(), asked = [], told = [];
  r.api.hooks.approvalNeeded = s => asked.push(s.id);
  for (const k of ['connected', 'disconnected']) r.api.hooks[k] = s => told.push([k, String(s.fingerprint || '').slice(0, 16)]);
  try {
    const made = r.api.createSlot(ann, { name: 'Claude' }), thief = makeAgent(), mine = makeAgent();
    const out = r.api.enrol(enrolBody(thief, made.code), { ip: '198.51.100.7' });
    assert.equal(out.approval, 'waiting'); assert.deepEqual(asked, [made.slot.id], 'its owner is told at once');
    const v = r.api.list(ann).find(a => a.id === made.slot.id);
    assert.equal(v.approval, 'waiting'); assert.equal(v.fingerprint.slice(0, 16), fingerprintOf(thief.pub).slice(0, 16), 'the owner sees the key to compare');
    refused(() => login(r, thief, made.slot.id), 403, 'awaiting_approval');
    refused(() => login(r, thief, made.slot.id), 403, 'awaiting_approval');
    refused(() => r.api.enrol(enrolBody(mine, made.code)), 401, 'enrol_refused');   // the code worked once: the owner's own AI can't use it now
    refused(() => r.api.approve(ben, made.slot.id), 404, 'not_found');   // nobody else answers for it
    refused(() => r.api.decline(ben, made.slot.id), 404, 'not_found');
    assert.equal(r.api.decline(ann, made.slot.id).status, 'pending', 'declined: back to waiting for a code');
    refused(() => login(r, thief, made.slot.id), 401, 'resign');   // the thief's key is forgotten
    refused(() => r.api.approve(ann, made.slot.id), 409, 'nothing_to_approve');
    const fresh = r.api.newEnrolmentCode(ann, made.slot.id);
    assert.equal(r.api.enrol(enrolBody(mine, fresh.code)).approval, 'waiting');
    r.api.approve(ann, made.slot.id);
    assert.ok(login(r, mine, made.slot.id), 'its owner\'s own AI, approved, works');
    assert.deepEqual(told, [['connected', fingerprintOf(mine.pub).slice(0, 16)]], 'its owner hears it is connected (not of the declined key)');
    refused(() => r.api.approve(ann, made.slot.id), 409, 'nothing_to_approve');
    refused(() => r.api.decline(ann, made.slot.id), 409, 'nothing_to_approve');   // an approved key is disconnected, not declined
    r.api.revoke(ann, made.slot.id);
    assert.equal(told.at(-1)[0], 'disconnected', 'and that it was disconnected');
    r.api.revoke(ann, made.slot.id);
    assert.equal(told.length, 2, 'disconnecting it again tells nothing new');
    const actions = new Set(r.audit.list({ limit: 200 }).map(e => e.action));
    for (const x of ['agent.decline', 'agent.approve']) assert.ok(actions.has(x), x);
  } finally { r.close(); }
});

test('a token never outlives its approval: a key replaced by a new enrolment waits again, and no session is handed out meanwhile', () => {
  const r = rig();
  try {
    const { a, id } = enrolled(r), s = login(r, a, id);
    assert.ok(r.api.authenticate(s.token));
    const rot = r.api.newEnrolmentCode(ann, id), b = makeAgent();
    r.api.enrol(enrolBody(b, rot.code));
    assert.equal(r.api.authenticate(s.token), null, 'the old key\'s session ended');
    assert.equal(r.slotRow(id).approved_at, null);
    refused(() => login(r, b, id), 403, 'awaiting_approval');
    assert.equal(r.store.db.prepare('SELECT COUNT(*) n FROM agent_sessions WHERE slot_id = ?').get(id).n, 0, 'no session for a key waiting for its OK');
  } finally { r.close(); }
});

test('the admin\'s switch: with "a new connection waits for its owner\'s OK" off, a new key is approved at once', () => {
  const r = rig();
  r.api.deps.flag = k => (k === 'requireApproval' ? false : true);
  try {
    const made = r.api.createSlot(ann, { name: 'Claude' }), a = makeAgent();
    assert.equal(r.api.enrol(enrolBody(a, made.code)).approval, 'approved');
    assert.ok(login(r, a, made.slot.id));
  } finally { r.close(); }
});

test('a new address: its owner hears of it once a day at most; the first address and a known one say nothing', () => {
  const r = rig(), heard = [];
  r.api.hooks.newAddress = (s, before) => heard.push(before);
  try {
    const { a, id } = enrolled(r);
    login(r, a, id, '203.0.113.5'); login(r, a, id, '203.0.113.5');
    assert.deepEqual(heard, [], 'its first address is not news');
    login(r, a, id, '198.51.100.1');
    assert.deepEqual(heard, [1], 'a second address is');
    login(r, a, id, '198.51.100.2'); login(r, a, id, '203.0.113.5');
    assert.deepEqual(heard, [1], 'once a day at most');
    r.advance(86400000 + 1);
    login(r, a, id, '198.51.100.3');
    assert.deepEqual(heard, [1, 3], 'the next day, again');
    assert.equal(r.api.list(ann).find(x => x.id === id).addresses, 4);
    assert.equal(JSON.stringify(r.slotRow(id)).includes('198.51.100'), false, 'addresses kept only as salted hashes');
  } finally { r.close(); }
});
