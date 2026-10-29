// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The built-in brains' adapter (server/providers/models.js): what each provider is sent, how its answer and its failures
// are read (our own messages, never the provider's text), and where a custom provider may not reach.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import adapter, { BASE, privateAddress } from '../../server/providers/models.js';

let srv, url;
const reqs = [];
let reply = () => ({ status: 200, body: {} });
before(async () => {
  srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', d => { b += d; });
    req.on('end', () => {
      reqs.push({ url: req.url, headers: req.headers, body: b ? JSON.parse(b) : null });
      const r = reply(reqs.at(-1));
      res.statusCode = r.status;
      for (const [k, v] of Object.entries(r.headers || {})) res.setHeader(k, v);
      res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => srv.on('listening', r));
  url = `http://127.0.0.1:${srv.address().port}`;
  for (const k of ['openai', 'openrouter', 'google', 'anthropic']) BASE[k] = `${url}/${k}`;
});
after(() => srv.close());

const ok = (content, extra = {}) => () => ({ status: 200, body: { model: 'm-1', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 12, completion_tokens: 3, ...extra } } });
const call = (provider, o = {}) => adapter.complete({ config: { provider, model: 'm', thinking: o.thinking }, secrets: { apiKey: 'sk-SECRET-1' }, system: 'S', user: 'U', json: o.json, maxTokens: 100, timeoutMs: 3000 });

test('OpenRouter: thinking switched off, the cost in the answer; OpenAI: completion tokens and its reasoning effort', async () => {
  reply = ok('{"a":1}', { cost: 0.0000425 });
  const r = await call('openrouter', { json: true });
  const q = reqs.at(-1);
  assert.equal(q.url, '/openrouter/chat/completions');
  assert.equal(q.headers.authorization, 'Bearer sk-SECRET-1');
  assert.deepEqual(q.body.reasoning, { enabled: false });
  assert.deepEqual(q.body.usage, { include: true });
  assert.deepEqual(q.body.response_format, { type: 'json_object' });
  assert.equal(q.body.max_tokens, 100);
  assert.deepEqual(q.body.messages, [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }]);
  assert.deepEqual({ text: r.text, in: r.usage.in, out: r.usage.out, cost: r.costUsd, model: r.model }, { text: '{"a":1}', in: 12, out: 3, cost: 0.0000425, model: 'm-1' });
  await call('openrouter', { thinking: 'low' });
  assert.deepEqual(reqs.at(-1).body.reasoning, { effort: 'low' });
  assert.equal(reqs.at(-1).body.max_tokens, 100 + 1024, 'its thinking has room of its own: it counts against the limit');
  reply = ok('hi');
  const o = await call('openai', { thinking: 'medium' });
  assert.equal(reqs.at(-1).body.max_completion_tokens, 100 + 4096, 'reasoning counts against max_completion_tokens');
  assert.equal(reqs.at(-1).body.max_tokens, undefined);
  assert.equal(reqs.at(-1).body.reasoning_effort, 'medium');
  assert.equal(o.costUsd, null, 'no cost reported: the server prices it');
  await call('google');
  assert.equal(reqs.at(-1).url, '/google/chat/completions');
});

test('Anthropic: its Messages API, the answer started with "{" for JSON (not while it thinks)', async () => {
  reply = () => ({ status: 200, body: { model: 'claude-x', stop_reason: 'end_turn', content: [{ type: 'text', text: '"a":2}' }], usage: { input_tokens: 20, output_tokens: 4 } } });
  const r = await call('anthropic', { json: true });
  const q = reqs.at(-1);
  assert.equal(q.url, '/anthropic/messages');
  assert.equal(q.headers['x-api-key'], 'sk-SECRET-1');
  assert.equal(q.headers['anthropic-version'], '2023-06-01');
  assert.equal(q.body.system, 'S');
  assert.deepEqual(q.body.messages, [{ role: 'user', content: 'U' }, { role: 'assistant', content: '{' }]);
  assert.equal(r.text, '{"a":2}');
  assert.deepEqual(r.usage, { in: 20, out: 4 });
  reply = () => ({ status: 200, body: { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: '{"b":1}' }], usage: {} } });
  const t = await call('anthropic', { json: true, thinking: 'low' });
  assert.deepEqual(reqs.at(-1).body.thinking, { type: 'enabled', budget_tokens: 1024 });
  assert.equal(reqs.at(-1).body.messages.length, 1, 'no prefill while thinking');
  assert.equal(reqs.at(-1).body.max_tokens, 100 + 1024);
  assert.equal(t.text, '{"b":1}');
});

test('failures carry a code and our own words, never the provider\'s text', async () => {
  const cases = [[401, 'auth'], [403, 'auth'], [402, 'quota'], [429, 'rate_limited'], [400, 'bad_request'], [404, 'bad_request'], [500, 'provider_error'], [503, 'provider_error']];
  for (const [status, code] of cases) {
    reply = () => ({ status, headers: status === 429 ? { 'retry-after': '7' } : {}, body: { error: { message: 'your key sk-SECRET-1 is wrong', code: 'x' } } });
    const e = await call('openai').then(() => null, x => x);
    assert.equal(e.code, code, String(status));
    assert.equal(e.message.includes('SECRET'), false);
    if (status === 429) assert.equal(e.retryAfterMs, 7000);
  }
  reply = () => ({ status: 400, body: { error: { code: 'insufficient_quota' } } });
  assert.equal((await call('openai').catch(x => x)).code, 'quota');
  reply = () => ({ status: 200, body: { choices: [{ finish_reason: 'content_filter', message: { content: null } }] } });
  assert.equal((await call('openai').catch(x => x)).code, 'refused');
  reply = () => ({ status: 200, body: { choices: [] } });
  assert.equal((await call('openai').catch(x => x)).code, 'provider_error');
  reply = () => ({ status: 200, body: 'not json' });
  assert.equal((await call('openai').catch(x => x)).code, 'provider_error');
  reply = () => ({ status: 200, body: 'x'.repeat(3 * 1048576) });
  assert.equal((await call('openai').catch(x => x)).code, 'provider_error', 'an answer too large is not read');
  assert.equal((await adapter.complete({ config: { provider: 'openai' }, secrets: {}, user: 'U' }).catch(x => x)).code, 'auth', 'no key');
  assert.equal((await adapter.complete({ config: { provider: 'nope' }, secrets: { apiKey: 'k' }, user: 'U' }).catch(x => x)).code, 'bad_request');
  const t = await adapter.test({ config: { provider: 'openai', model: 'm' }, secrets: { apiKey: 'k' } });
  assert.equal(t.ok, false); assert.equal(t.code, 'provider_error'); assert.ok(t.fix);
});

test('a custom provider: a public https address only — unless the installation says the local network is fine', async () => {
  // (the private examples are reviewed exceptions of the neutrality scan; the public ones are documentation addresses)
  for (const a of ['127.0.0.1', '10.1.2.3', '100.64.5.6', '169.254.169.254', '172.20.0.1', '192.168.1.5', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:10.1.2.3', '224.0.0.1']) assert.equal(privateAddress(a), true, a);
  for (const a of ['198.51.100.7', '203.0.113.5', '2001:4860::8888', '100.128.0.1']) assert.equal(privateAddress(a), false, a);
  const custom = (baseUrl, allowPrivate = false) => adapter.complete({ config: { provider: 'custom', baseUrl, model: 'm' }, secrets: { apiKey: 'k' }, user: 'U', timeoutMs: 3000, allowPrivate }).then(() => 'ok', e => e.code);
  assert.equal(await custom(`${url.replace('http:', 'https:')}/v1`), 'blocked');
  assert.equal(await custom('https://localhost/v1'), 'blocked');
  assert.equal(await custom(`${url}/v1`), 'blocked', 'https only');
  assert.equal(await custom('https://user:pw@example.com/v1'), 'bad_request');
  reply = ok('{}');
  assert.equal(await custom(`${url}/custom/v1`, true), 'ok', 'the installation\'s own connection may name a local server');
  assert.equal(reqs.at(-1).url, '/custom/v1/chat/completions');
});

test('a server of one\'s own (Ollama, LM Studio) with no key: no Authorization header; a vendor still needs its key', async () => {
  reply = ok('hi');
  const r = await adapter.complete({ config: { provider: 'custom', baseUrl: `${url}/ollama/v1`, model: 'qwen3:8b' }, secrets: {}, user: 'U', timeoutMs: 3000, allowPrivate: true });
  assert.equal(r.text, 'hi');
  assert.equal(reqs.at(-1).url, '/ollama/v1/chat/completions'); assert.equal(reqs.at(-1).headers.authorization, undefined);
  await adapter.complete({ config: { provider: 'custom', baseUrl: `${url}/ollama/v1`, model: 'qwen3:8b' }, secrets: { apiKey: 'lm-studio' }, user: 'U', timeoutMs: 3000, allowPrivate: true });
  assert.equal(reqs.at(-1).headers.authorization, 'Bearer lm-studio', 'a key, when there is one');
  assert.equal((await adapter.complete({ config: { provider: 'openrouter' }, secrets: {}, user: 'U' }).catch(e => e)).code, 'auth');
  const refused = await adapter.complete({ config: { provider: 'custom', baseUrl: `${url}/ollama/v1`, model: 'm' }, secrets: {}, user: 'U', timeoutMs: 3000 }).catch(e => e);
  assert.equal(refused.code, 'blocked'); assert.match(refused.message, /administrator/, 'says who may add one on this network');
});

test('the model list', async () => {
  reply = () => ({ status: 200, body: { data: [{ id: 'a/b', name: 'A B' }, { id: '' }] } });
  const r = await adapter.models({ config: { provider: 'openrouter' }, secrets: { apiKey: 'k' } });
  assert.deepEqual(r.models, [{ id: 'a/b', label: 'A B' }]);
  assert.equal(reqs.at(-1).url, '/openrouter/models');
});

test('a conversation (a thought that uses tools): the turns in order after the system message; it must end with a user turn', async () => {
  const turns = [{ role: 'user', text: 'U1' }, { role: 'assistant', text: '{"use":[]}' }, { role: 'user', text: 'RESULTS' }];
  reply = ok('{"a":3}');
  await adapter.complete({ config: { provider: 'openai', model: 'm' }, secrets: { apiKey: 'k' }, system: 'S', turns, json: true, timeoutMs: 3000 });
  assert.deepEqual(reqs.at(-1).body.messages, [{ role: 'system', content: 'S' }, { role: 'user', content: 'U1' }, { role: 'assistant', content: '{"use":[]}' }, { role: 'user', content: 'RESULTS' }]);
  reply = () => ({ status: 200, body: { model: 'c', content: [{ type: 'text', text: '"a":4}' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 2 } } });
  await adapter.complete({ config: { provider: 'anthropic', model: 'm' }, secrets: { apiKey: 'k' }, system: 'S', turns, json: true, timeoutMs: 3000 });
  assert.deepEqual(reqs.at(-1).body.messages, [{ role: 'user', content: 'U1' }, { role: 'assistant', content: '{"use":[]}' }, { role: 'user', content: 'RESULTS' }, { role: 'assistant', content: '{' }]);
  const n = reqs.length;
  for (const bad of [[{ role: 'user', text: 'U' }, { role: 'assistant', text: 'A' }], [], [{ role: 'user', text: '' }]]) {
    await assert.rejects(adapter.complete({ config: { provider: 'openai', model: 'm' }, secrets: { apiKey: 'k' }, turns: bad, timeoutMs: 3000 }), e => e.code === 'bad_request');
  }
  assert.equal(reqs.length, n, 'nothing was sent');
});
