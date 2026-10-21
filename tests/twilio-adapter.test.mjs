// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Twilio adapter (server/providers/twilio.js) against the fake Twilio: credentials checked before any call, Basic
// auth with an API key standing in for the Auth Token, lists read page by page, Twilio's errors in our own words (its
// number kept, its text never), the call handler deployed and found again, the phone's numbers written any way.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { makeTwilio, errorWords } from '../server/providers/twilio.js';
import { normalizeNumber, prettyNumber } from '../server/phone/phone.js';
import { callUrl, isOurCallUrl, bridgeTwiml, CALL_FN } from '../server/phone/callfn.js';
import { startFakeTwilio } from './helpers/fake-twilio.mjs';

let tw, T, p;
before(async () => {
  tw = await startFakeTwilio({ numbers: [{ number: '+18885550100' }] });
  T = makeTwilio({ hosts: { api: tw.url, serverless: tw.url, upload: tw.url } });
  p = o => ({ config: { accountSid: tw.account }, secrets: { authToken: tw.token }, ...o });
});
after(() => tw.close());

test('credentials are checked before Twilio is asked', async () => {
  await assert.rejects(T.account({ config: { accountSid: 'nope' }, secrets: { authToken: tw.token } }), { code: 'bad_request' });
  await assert.rejects(T.account({ config: { accountSid: tw.account }, secrets: { authToken: 'short' } }), { code: 'auth' });
  await assert.rejects(T.account({ config: { accountSid: tw.account, apiKeySid: 'SKbad' }, secrets: { authToken: tw.token } }), { code: 'bad_request' });
  const n0 = tw.S.requests.length;
  await assert.rejects(T.account(p({ secrets: { authToken: 'z'.repeat(32) } })), e => e.code === 'auth' && e.twilioCode === 20003 && !/Authenticate/.test(e.message));
  assert.equal(tw.S.requests.length, n0 + 1);
  assert.deepEqual(await T.account(p()), { name: 'Fake Acme', status: 'active', trial: false });
});

test('lists come page by page; filters go as Twilio documents them', async () => {
  for (let i = 0; i < 7; i++) tw.inbound({ from: '+15552010042', to: '+18885550100', body: `m${i}`, at: Date.now() - i * 1000 });
  const r = await T.messages(p({ to: '+18885550100', after: Date.now() - 3600000, pageSize: 3, pages: 5 }));
  assert.deepEqual(r.messages.map(m => m.body), ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6']);
  const q = tw.S.requests.filter(x => x.path.endsWith('/Messages.json'));
  assert.equal(q.length, 3);
  assert.equal(q[0].query.To, '+18885550100');
  assert.match(q[0].query['DateSent>'], /^\d{4}-\d\d-\d\d$/);
  await assert.rejects(T.messages(p({})), { code: 'bad_request' });
});

test('Twilio\'s errors in our words', async () => {
  await assert.rejects(T.send(p({ from: '+18885550100', to: '12345', body: 'x' })), { code: 'bad_request' });
  tw.S.failNext = { path: '/Messages.json', status: 400, code: 21610 };
  await assert.rejects(T.send(p({ from: '+18885550100', to: '+15552010042', body: 'hi' })), e => e.twilioCode === 21610 && /replied STOP/.test(e.message));
  tw.S.failNext = { path: '/Messages.json', status: 500, code: 99999 };
  await assert.rejects(T.send(p({ from: '+18885550100', to: '+15552010042', body: 'hi' })), { code: 'provider_error' });
  assert.match(errorWords(30034), /A2P 10DLC/);
  assert.match(errorWords(12345), /error 12345/);
  assert.equal(errorWords(null), null);
});

test('the call handler: deployed once, found again and updated in place', async () => {
  const a = await T.deploy(p({ uniqueName: 'mvw-phone-test', friendlyName: 'x', path: '/call', code: CALL_FN, pollMs: 1 }));
  assert.match(a.domain, /\.twil\.io$/);
  const b = await T.deploy(p({ uniqueName: 'mvw-phone-test', friendlyName: 'x', path: '/call', code: CALL_FN, pollMs: 1 }));
  assert.equal(b.service, a.service);
  assert.equal(tw.S.services.length, 1);
  assert.equal(tw.S.functions.length, 1);
  assert.equal(tw.S.versions.length, 2);
  await assert.rejects(T.deploy(p({ uniqueName: 'Bad Name', code: CALL_FN })), { code: 'bad_request' });
});

test('numbers as people write them; call addresses; the call-me-first script', () => {
  assert.equal(normalizeNumber('(555) 201-0042'), '+15552010042');
  assert.equal(normalizeNumber('1-555-201-0042'), '+15552010042');
  assert.equal(normalizeNumber('+44 20 7946 0958'), '+442079460958');
  assert.equal(normalizeNumber('0044 20 7946 0958'), '+442079460958');
  assert.equal(normalizeNumber('2589009'), null);
  assert.equal(normalizeNumber('call me'), null);
  assert.equal(prettyNumber('+15552010042'), '(555) 201-0042');
  assert.equal(prettyNumber('+442079460958'), '+442079460958');
  const u = callUrl('x-1-phone.twil.io', { mode: 'forward', forwardTo: '+17865550148', voicemail: true, name: 'Max', ringSeconds: 99 });
  assert.equal(new URL(u).searchParams.get('t'), '60');
  assert.ok(isOurCallUrl(u, 'x-1-phone.twil.io'));
  assert.ok(!isOurCallUrl('https://api.us.elevenlabs.io/twilio/inbound_call', 'x-1-phone.twil.io'));
  assert.throws(() => callUrl('evil.example.com', { mode: 'voicemail' }));
  assert.throws(() => callUrl('x-1-phone.twil.io', { mode: 'forward', forwardTo: 'nope' }));
  const t = bridgeTwiml({ to: '+15552010042', from: '+18885550100', name: 'Dana <&> "J"' });
  assert.match(t, /Calling Dana &lt;&amp;&gt; &quot;J&quot;\./);
  assert.match(t, /<Dial callerId="\+18885550100"/);
});

test('the call handler\'s code answers as its settings say (run with a stand-in for Twilio\'s helper library)', async () => {
  const { default: vm } = await import('node:vm');
  const run = event => {
    const verbs = [];
    class VoiceResponse {
      say(a, b) { verbs.push(['say', typeof a === 'string' ? a : b]); }
      record(o) { verbs.push(['record', o]); }
      hangup() { verbs.push(['hangup']); }
      dial(o) { const d = ['dial', o, []]; verbs.push(d); return { number: n => d[2].push(n) }; }
    }
    const box = { exports: {}, Twilio: { twiml: { VoiceResponse } }, URLSearchParams };
    vm.runInNewContext(CALL_FN, box);
    let out = null;
    box.exports.handler({}, event, (e, r) => { out = r; });
    return { verbs, out };
  };
  const fwd = run({ mode: 'forward', to: '+17865550148', t: '25', vm: '1', name: 'Max', From: '+15552010042', To: '+18885550100' });
  const d = fwd.verbs[0];
  assert.equal(d[0], 'dial');
  assert.deepEqual([d[1].callerId, d[1].timeout, d[2][0]], ['+15552010042', 25, '+17865550148']);
  assert.match(d[1].action, /^\/call\?.*step=after/);
  assert.match(d[1].action, /to=%2B17865550148/);
  const after = run({ mode: 'forward', to: '+17865550148', vm: '1', step: 'after', DialCallStatus: 'no-answer', name: 'Max' });
  assert.deepEqual(after.verbs.map(v => v[0]), ['say', 'record', 'say', 'hangup']);
  assert.match(after.verbs[0][1], /You have reached Max/);
  assert.equal(after.verbs[1][1].transcribe, true);
  assert.match(after.verbs[1][1].action, /step=done/);
  assert.deepEqual(run({ mode: 'forward', to: '+17865550148', step: 'after', DialCallStatus: 'completed' }).verbs, [['hangup']]);
  const vmail = run({ mode: 'voicemail', greet: 'Acme Plumbing, leave a message.' });
  assert.equal(vmail.verbs[0][1], 'Acme Plumbing, leave a message.');
  assert.deepEqual(run({ mode: 'voicemail', step: 'done' }).verbs.map(v => v[0]), ['say', 'hangup']);
  assert.deepEqual(run({ mode: 'forward', to: 'not-a-number' }).verbs.map(v => v[0]), ['say', 'hangup'], 'a bad forward number never dials');
});
