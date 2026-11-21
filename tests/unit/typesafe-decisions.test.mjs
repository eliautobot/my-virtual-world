// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The TypeSafe (Jev) decision service (server/providers/typesafe-decisions.js) against a fake System One server: Free
// Will's Decisions-shaped questions go out as System One's (choice → choice with criteria, predicate → noul, score →
// score levels), the key in the Authorization header with an ordinary client signature, and the answers come back in the
// Decisions shape; a refused key, a rate limit and the edge's refusal are said by code; a question it cannot ask is
// refused before anything is sent.
import assert from 'node:assert/strict';
import http from 'node:http';
import { test, after, before } from 'node:test';
import ts, { toSystemOne, fromSystemOne } from '../../server/providers/typesafe-decisions.js';

let srv, base, seen = [], reply = null;
before(async () => {
  srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; });
    req.on('end', () => {
      seen.push({ url: req.url, headers: req.headers, body: b ? JSON.parse(b) : null });
      const r = reply || { status: 200, json: { model: 'jev-1.14.0', answers: { act: { type: 'choice', choice: 'follow', confidence: 0.9, probabilities: { follow: 0.9, wait: 0.1 } }, speak: { type: 'noul', noul: 0.2 } }, usage: { input_tokens: 300, output_tokens: 40 } } };
      res.writeHead(r.status, { 'content-type': 'application/json', ...(r.headers || {}) }); res.end(JSON.stringify(r.json));
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv?.close());

const Q = { input: 'Kai walks beside Kim.', questions: [{ type: 'choice', name: 'act', instructions: 'What does Kai do?', choices: [{ value: 'follow', description: 'Go along' }, { value: 'wait', description: 'Stay' }] }, { type: 'predicate', name: 'speak', instructions: 'Say something?' }] };

test('the Decisions shape becomes System One\'s, and its answers come back in the Decisions shape', () => {
  const s = toSystemOne({ ...Q, questions: [...Q.questions, { type: 'score', name: 'mood', instructions: 'How happy?', levels: ['sad', 'fine', 'happy'] }] }, 'jev-latest');
  assert.deepEqual(s, { model: 'jev-latest', state: 'Kai walks beside Kim.', questions: {
    act: { type: 'choice', instructions: 'What does Kai do?', criteria: { follow: 'Go along', wait: 'Stay' } },
    speak: { type: 'noul', instructions: 'Say something?' },
    mood: { type: 'score', instructions: 'How happy?', criteria: ['sad', 'fine', 'happy'] } } });
  assert.throws(() => toSystemOne({ input: 'x', questions: [{ type: 'choice', name: 'a', choices: [] }] }), /no choices/);
  assert.throws(() => toSystemOne({ input: 'x', questions: [{ type: 'box', name: 'a' }] }), /unknown kind/);
  assert.throws(() => toSystemOne({ input: 'x', questions: [{ type: 'predicate', name: 'a' }, { type: 'predicate', name: 'a' }] }), /its own name/);
  assert.deepEqual(fromSystemOne({ act: { type: 'choice', choice: 'follow', confidence: 1, probabilities: { follow: 1, wait: 0 } }, speak: { type: 'noul', noul: 0.13 },
    mood: { type: 'score', score: 1.4, confidence: 0.4, probabilities: { 0: 0, 1: 0.6, 2: 0.4 } }, junk: null }), [
    { type: 'choice', name: 'act', choice: 'follow', confidence: 1, probabilities: [{ value: 'follow', probability: 1 }, { value: 'wait', probability: 0 }] },
    { type: 'predicate', name: 'speak', probability: 0.13 },
    { type: 'score', name: 'mood', score: 1.4, confidence: 0.4, probabilities: [{ value: '0', probability: 0 }, { value: '1', probability: 0.6 }, { value: '2', probability: 0.4 }] }]);
});

test('decide: one POST /v1/systemone with the key and an ordinary client signature; answers, model, usage', async () => {
  // (the adapter only speaks https to the real service; a test server is reached through the same code path with http)
  const real = globalThis.fetch;
  globalThis.fetch = (u, o) => real(String(u).replace('https://api.example.test', base), o);
  try {
    const r = await ts.decide({ config: { model: 'jev-latest', baseUrl: 'https://api.example.test' }, secrets: { apiKey: 'sk-TS-1' }, request: Q, timeoutMs: 3000 });
    assert.equal(seen.at(-1).url, '/v1/systemone');
    assert.equal(seen.at(-1).headers.authorization, 'Bearer sk-TS-1');
    assert.match(seen.at(-1).headers['user-agent'], /^MyVirtualWorld\//);
    assert.equal(seen.at(-1).body.questions.speak.type, 'noul');
    assert.deepEqual(r.answers.map(a => [a.type, a.name]), [['choice', 'act'], ['predicate', 'speak']]);
    assert.equal(r.model, 'jev-1.14.0'); assert.equal(r.usage.inputTokens, 300);
    for (const [status, json, code] of [[401, { detail: 'no' }, 'auth'], [403, { error: 'error code 1010' }, 'provider_error'], [429, {}, 'rate_limited'], [422, {}, 'bad_request'], [500, {}, 'provider_error']]) {
      reply = { status, json };
      await assert.rejects(ts.decide({ config: { baseUrl: 'https://api.example.test' }, secrets: { apiKey: 'k' }, request: Q }), e => e.code === code);
    }
    reply = null;
    await assert.rejects(ts.decide({ config: {}, secrets: {}, request: Q }), e => e.code === 'auth');
    await assert.rejects(ts.decide({ config: { baseUrl: 'http://plain.example' }, secrets: { apiKey: 'k' }, request: Q }), e => e.code === 'bad_request');
    const t = await ts.test({ config: { baseUrl: 'https://api.example.test' }, secrets: { apiKey: 'k' } });
    assert.equal(t.ok, false, 'the test asks one predicate; this fake answers a choice');
  } finally { globalThis.fetch = real; }
});
