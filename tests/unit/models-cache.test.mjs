// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Prompt caching in the built-in brains' adapter (server/providers/models.js): a conversation's cacheKey becomes
// OpenRouter's session_id, OpenAI's prompt_cache_key and, on Claude models, cache breakpoints on the system prompt and
// the conversation so far (only once a prefix is long enough to be cached); without a key a request is as it was.
// Every answer's usage says what came from the provider's cache (cached) and what was written to it (cacheWrite), in
// each provider's shape, streamed or not; the price of a call counts the cache's own prices where they are known.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import adapter, { BASE, cacheKeyOf, costMicros, usageOf } from '../../server/providers/models.js';

let srv, url;
const reqs = [];
let script = null;   // (req, res, body) => void
before(async () => {
  srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', d => { b += d; });
    req.on('end', () => {
      const body = b ? JSON.parse(b) : null;
      reqs.push({ url: req.url, headers: req.headers, body });
      script(req, res, body);
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => srv.on('listening', r));
  url = `http://127.0.0.1:${srv.address().port}`;
  for (const k of ['openai', 'openrouter', 'google', 'anthropic']) BASE[k] = `${url}/${k}`;
});
after(() => srv.close());

const json = body => (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const sse = events => (req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(`data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`);
  res.end();
};
const chat = (usage, content = 'ok') => json({ model: 'm-1', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }], usage });
const claude = usage => json({ model: 'claude-x', stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage });

const LONG = 'You are a resident of a small virtual city. '.repeat(120);   // ≈5,300 characters: past every Claude minimum but Haiku 4.5's
const TURNS = [{ role: 'user', text: 'What is on today?' }, { role: 'assistant', text: 'A market at noon.' }, { role: 'user', text: 'And tonight?' }];
const call = (provider, o = {}) => adapter.complete({ config: { provider, model: o.model || 'm', baseUrl: o.baseUrl }, secrets: { apiKey: 'sk-S' }, allowPrivate: true,
  system: o.system ?? 'S', ...(o.turns ? { turns: o.turns } : { user: 'U' }), ...(o.cacheKey !== undefined ? { cacheKey: o.cacheKey } : {}),
  stream: !!o.stream, json: o.json, maxTokens: 100, timeoutMs: 3000 });
const breakpoints = body => (JSON.stringify(body).match(/"cache_control"/g) || []).length;

test('without a cacheKey every request is as it was: no session_id, no prompt_cache_key, no breakpoints', async () => {
  script = chat({ prompt_tokens: 5, completion_tokens: 1 });
  for (const provider of ['openrouter', 'openai', 'google']) {
    await call(provider, { system: LONG, turns: TURNS });
    const b = reqs.at(-1).body;
    assert.deepEqual([b.session_id, b.prompt_cache_key, breakpoints(b)], [undefined, undefined, 0], provider);
    assert.equal(b.messages[0].content, LONG, 'the system prompt stays a string');
    assert.deepEqual(b.messages.slice(1).map(m => m.content), ['What is on today?', 'A market at noon.', 'And tonight?']);
  }
  await call('openrouter', { model: 'anthropic/claude-sonnet-5.5', system: LONG, turns: TURNS });
  assert.equal(breakpoints(reqs.at(-1).body), 0, 'a Claude model on OpenRouter: unmarked without a key');
  script = claude({ input_tokens: 5, output_tokens: 1 });
  await call('anthropic', { model: 'claude-sonnet-5-5', system: LONG, turns: TURNS });
  const b = reqs.at(-1).body;
  assert.equal(b.system, LONG);
  assert.deepEqual(b.messages, [{ role: 'user', content: 'What is on today?' }, { role: 'assistant', content: 'A market at noon.' }, { role: 'user', content: 'And tonight?' }]);
  assert.equal(breakpoints(b), 0);
});

test('OpenRouter: the key is the session_id (sticky routing); OpenAI: the prompt_cache_key; Google and custom: nothing extra', async () => {
  script = chat({ prompt_tokens: 5, completion_tokens: 1 });
  await call('openrouter', { cacheKey: 'agent12:session345', system: LONG, turns: TURNS });
  let b = reqs.at(-1).body;
  assert.deepEqual([b.session_id, b.prompt_cache_key, breakpoints(b)], ['agent12:session345', undefined, 0], 'a model that caches by itself: no breakpoints');
  assert.deepEqual(b.usage, { include: true }, 'its own cost, already discounted, still asked for');
  await call('openai', { cacheKey: 'agent12:session345', system: LONG, turns: TURNS });
  b = reqs.at(-1).body;
  assert.deepEqual([b.prompt_cache_key, b.session_id, breakpoints(b)], ['agent12:session345', undefined, 0]);
  for (const provider of ['google', 'custom']) {
    await call(provider, { cacheKey: 'agent12:session345', system: LONG, turns: TURNS, baseUrl: `${url}/custom/v1` });
    b = reqs.at(-1).body;
    assert.deepEqual([b.prompt_cache_key, b.session_id, breakpoints(b)], [undefined, undefined, 0], provider);
  }
  assert.equal(reqs.at(-1).url, '/custom/v1/chat/completions');
});

test('Anthropic: breakpoints on the system prompt and the conversation so far, content parts, the newest message unmarked', async () => {
  script = claude({ input_tokens: 5, output_tokens: 1 });
  await call('anthropic', { model: 'claude-sonnet-5-5', cacheKey: 'agent12:session345', system: LONG, turns: TURNS });
  const b = reqs.at(-1).body;
  assert.deepEqual(b.system, [{ type: 'text', text: LONG, cache_control: { type: 'ephemeral' } }]);
  assert.deepEqual(b.messages, [{ role: 'user', content: 'What is on today?' },
    { role: 'assistant', content: [{ type: 'text', text: 'A market at noon.', cache_control: { type: 'ephemeral' } }] },
    { role: 'user', content: 'And tonight?' }]);
  assert.equal(breakpoints(b), 2, 'within Anthropic\'s four');
  assert.equal(b.session_id, undefined);
  // one question (a thought): the system prompt only; a JSON answer still started with "{" after it
  await call('anthropic', { model: 'claude-sonnet-5-5', cacheKey: 'k', system: LONG, json: true });
  const one = reqs.at(-1).body;
  assert.equal(breakpoints(one), 1);
  assert.deepEqual(one.messages, [{ role: 'user', content: 'U' }, { role: 'assistant', content: '{' }]);
});

test('Anthropic: a prompt too short to be cached is sent unmarked (by the model\'s own minimum); images keep their breakpoint', async () => {
  script = claude({ input_tokens: 5, output_tokens: 1 });
  await call('anthropic', { model: 'claude-sonnet-5-5', cacheKey: 'k', system: 'Be brief.', turns: TURNS });
  let b = reqs.at(-1).body;
  assert.deepEqual([b.system, breakpoints(b)], ['Be brief.', 0], 'a tiny prompt: nothing to cache');
  await call('anthropic', { model: 'claude-haiku-4-5-20251001', cacheKey: 'k', system: LONG, turns: TURNS });
  assert.equal(breakpoints(reqs.at(-1).body), 0, 'Haiku 4.5 caches 4,096 tokens and more only');
  await call('anthropic', { model: 'claude-haiku-4-5-20251001', cacheKey: 'k', system: LONG.repeat(3), turns: TURNS });
  assert.equal(breakpoints(reqs.at(-1).body), 2);
  // a short system prompt but a long conversation: the conversation's breakpoint only
  await call('anthropic', { model: 'claude-sonnet-5-5', cacheKey: 'k', system: 'Be brief.', turns: [{ role: 'user', text: LONG }, { role: 'assistant', text: 'Noted.' }, { role: 'user', text: 'Go on.' }] });
  b = reqs.at(-1).body;
  assert.deepEqual([b.system, b.messages[1].content[0].cache_control, breakpoints(b)], ['Be brief.', { type: 'ephemeral' }, 1]);
  // an image as the last thing before the newest message carries the breakpoint (Anthropic caches images too)
  const img = { type: 'image', mime: 'image/png', data: 'iVBORw0KGgo=' };
  await call('anthropic', { model: 'claude-sonnet-5-5', cacheKey: 'k', system: LONG, turns: [{ role: 'user', text: '', parts: [img] }, { role: 'user', text: 'What is it?' }] });
  b = reqs.at(-1).body;
  assert.deepEqual(b.messages[0].content, [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' }, cache_control: { type: 'ephemeral' } }]);
});

test('a Claude model on OpenRouter: the session_id and the same breakpoints, in the chat completions shape', async () => {
  script = chat({ prompt_tokens: 5, completion_tokens: 1 });
  await call('openrouter', { model: 'anthropic/claude-sonnet-5.5', cacheKey: 'agent12:session345', system: LONG, turns: TURNS });
  const b = reqs.at(-1).body;
  assert.equal(b.session_id, 'agent12:session345');
  assert.deepEqual(b.messages, [{ role: 'system', content: [{ type: 'text', text: LONG, cache_control: { type: 'ephemeral' } }] },
    { role: 'user', content: 'What is on today?' },
    { role: 'assistant', content: [{ type: 'text', text: 'A market at noon.', cache_control: { type: 'ephemeral' } }] },
    { role: 'user', content: 'And tonight?' }]);
  // an image without text there: OpenRouter's image part takes no breakpoint, so that one is left out
  const img = { type: 'image', mime: 'image/png', data: 'iVBORw0KGgo=' };
  await call('openrouter', { model: 'anthropic/claude-sonnet-5.5', cacheKey: 'k', system: LONG, turns: [{ role: 'user', text: '', parts: [img] }, { role: 'user', text: 'What is it?' }] });
  assert.equal(breakpoints(reqs.at(-1).body), 1);
});

test('the key is made safe: printable, at most 120 characters (a long one keeps a digest), nothing when blank or not a string', async () => {
  assert.equal(cacheKeyOf('agent12:session345'), 'agent12:session345');
  assert.equal(cacheKeyOf(' a b\nc\u0000d '), 'a_b_c_d');
  for (const v of [undefined, null, 42, {}, '', '   ', '\n\t', '***']) assert.equal(cacheKeyOf(v), '', String(v));
  const long1 = cacheKeyOf(`agent1:${'x'.repeat(300)}`), long2 = cacheKeyOf(`agent1:${'x'.repeat(301)}`);
  assert.equal(long1.length, 120);
  assert.ok(long1.startsWith('agent1:xxx'));
  assert.notEqual(long1, long2, 'two long keys stay apart');
  assert.equal(cacheKeyOf(`agent1:${'x'.repeat(300)}`), long1, 'and stay the same from call to call');
  script = chat({ prompt_tokens: 5, completion_tokens: 1 });
  await call('openrouter', { cacheKey: `agent 7\n${'y'.repeat(400)}` });
  assert.equal(reqs.at(-1).body.session_id.length, 120);
  await call('openrouter', { cacheKey: '   ' });
  assert.equal(reqs.at(-1).body.session_id, undefined);
});

test('usage, not streamed: what came from the cache and what was written to it, in every provider\'s shape', async () => {
  const cases = [
    ['openai', chat({ prompt_tokens: 2006, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 1920 } }), { in: 2006, out: 300, cached: 1920 }],
    ['openai', chat({ prompt_tokens: 40, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 } }), { in: 40, out: 3, cached: 0 }],
    ['openrouter', chat({ prompt_tokens: 10339, completion_tokens: 60, cost: 0.0012, prompt_tokens_details: { cached_tokens: 10318, cache_write_tokens: 0 } }), { in: 10339, out: 60, cached: 10318, cacheWrite: 0 }],
    ['openrouter', chat({ prompt_tokens: 9000, completion_tokens: 60, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 8800 } }), { in: 9000, out: 60, cached: 0, cacheWrite: 8800 }],
    // DeepSeek's own API (a custom provider): its hit and miss counts
    ['custom', chat({ prompt_tokens: 1500, completion_tokens: 20, prompt_cache_hit_tokens: 1280, prompt_cache_miss_tokens: 220 }), { in: 1500, out: 20, cached: 1280 }],
    ['google', chat({ prompt_tokens: 5000, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 4096 } }), { in: 5000, out: 9, cached: 4096 }],
    // Gemini's own usage shape, where a server passes it on
    ['custom', json({ model: 'g', choices: [{ finish_reason: 'stop', message: { content: 'ok' } }], usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 12, cachedContentTokenCount: 2048 } }), { in: 3000, out: 12, cached: 2048 }],
    // nothing said about the cache: nothing claimed
    ['openai', chat({ prompt_tokens: 12, completion_tokens: 3 }), { in: 12, out: 3 }],
    // Anthropic counts the cache apart: in is all of it
    ['anthropic', claude({ input_tokens: 50, cache_read_input_tokens: 4000, cache_creation_input_tokens: 300, output_tokens: 20 }), { in: 4350, out: 20, cached: 4000, cacheWrite: 300 }],
    ['anthropic', claude({ input_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 4 }), { in: 20, out: 4, cached: 0, cacheWrite: 0 }],
    ['anthropic', claude({ input_tokens: 20, output_tokens: 4 }), { in: 20, out: 4 }],
  ];
  for (const [provider, s, want] of cases) {
    script = s;
    const r = await call(provider, { baseUrl: `${url}/custom/v1`, model: provider === 'anthropic' ? 'claude-sonnet-5-5' : 'm' });
    assert.deepEqual(r.usage, want, `${provider} ${JSON.stringify(want)}`);
  }
  script = chat({ prompt_tokens: 10339, completion_tokens: 60, cost: 0.0012, prompt_tokens_details: { cached_tokens: 10318 } });
  assert.equal((await call('openrouter')).costUsd, 0.0012, 'OpenRouter\'s own (discounted) cost stands');
});

test('usage, streamed: OpenAI-compatible at the end, Anthropic from its start and end, a server that does not stream', async () => {
  script = sse([{ model: 'm', choices: [{ delta: { content: 'Hi' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: null },
    { choices: [], usage: { prompt_tokens: 10339, completion_tokens: 60, cost: 0.0012, prompt_tokens_details: { cached_tokens: 10318, cache_write_tokens: 0 } } }, '[DONE]']);
  let r = await call('openrouter', { stream: true, cacheKey: 'agent12:session345' });
  assert.deepEqual([r.text, r.usage, r.costUsd], ['Hi', { in: 10339, out: 60, cached: 10318, cacheWrite: 0 }, 0.0012]);
  assert.equal(reqs.at(-1).body.session_id, 'agent12:session345');
  script = sse([{ model: 'm', choices: [{ delta: { content: 'Hi' }, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 2006, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 1920 } } }, '[DONE]']);
  r = await call('openai', { stream: true, cacheKey: 'k' });
  assert.deepEqual(r.usage, { in: 2006, out: 30, cached: 1920 });
  assert.equal(reqs.at(-1).body.prompt_cache_key, 'k');
  script = sse([{ choices: [{ delta: { content: 'Hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 1 } }, '[DONE]']);
  assert.deepEqual((await call('openai', { stream: true })).usage, { in: 7, out: 1 }, 'nothing said, nothing claimed');

  script = sse([{ type: 'message_start', message: { model: 'claude-x', usage: { input_tokens: 50, cache_read_input_tokens: 4000, cache_creation_input_tokens: 300, output_tokens: 1 } } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Bonjour' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 25 } }, { type: 'message_stop' }]);
  r = await call('anthropic', { stream: true, model: 'claude-sonnet-5-5', cacheKey: 'k', system: LONG, turns: TURNS });
  assert.deepEqual([r.text, r.usage], ['Bonjour', { in: 4350, out: 25, cached: 4000, cacheWrite: 300 }]);
  assert.equal(breakpoints(reqs.at(-1).body), 2, 'streamed or not, the same breakpoints');
  // the end's usage may repeat the input counts (cumulative): they are taken from it then
  script = sse([{ type: 'message_start', message: { model: 'claude-x', usage: { input_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 50, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0, output_tokens: 9 } }]);
  assert.deepEqual((await call('anthropic', { stream: true, model: 'claude-sonnet-5-5' })).usage, { in: 4050, out: 9, cached: 4000, cacheWrite: 0 });
  script = sse([{ type: 'message_start', message: { model: 'claude-x', usage: { input_tokens: 21 } } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }]);
  assert.deepEqual((await call('anthropic', { stream: true, model: 'claude-sonnet-5-5' })).usage, { in: 21, out: 3 });

  // a server that ignores "stream" and answers whole
  script = chat({ prompt_tokens: 1500, completion_tokens: 20, prompt_cache_hit_tokens: 1280, prompt_cache_miss_tokens: 220 }, 'whole');
  r = await call('custom', { stream: true, baseUrl: `${url}/custom/v1` });
  assert.deepEqual([r.text, r.usage], ['whole', { in: 1500, out: 20, cached: 1280 }]);
});

test('usageOf and costMicros: the cache priced at its own prices where known, else as before', () => {
  assert.deepEqual(usageOf(null), { in: null, out: null });
  assert.deepEqual(usageOf({ input_tokens: 100, input_tokens_details: { cached_tokens: 64 }, output_tokens: 5 }), { in: 100, out: 5, cached: 64 }, 'the Responses shape: input_tokens counts the cached part');
  // (prices in US$ per million tokens = millionths of a dollar per token)
  assert.equal(costMicros({ in: 1000, out: 100 }, { priceIn: 3, priceOut: 15 }), 4500);
  assert.equal(costMicros({ in: 1000, out: 100, cached: 800 }, { priceIn: 3, priceOut: 15 }), 4500, 'no cache prices: as before');
  assert.equal(costMicros({ in: 1000, out: 100, cached: 800, cacheWrite: 100 }, { priceIn: 3, priceOut: 15, priceCacheRead: 0.3, priceCacheWrite: 3.75 }),
    Math.round(100 * 3 + 800 * 0.3 + 100 * 3.75 + 100 * 15));
  assert.equal(costMicros({ in: 100, out: 0, cached: 500 }, { priceIn: 1, priceCacheRead: 0 }), 0, 'a cached count past the input is held to it');
  assert.equal(costMicros(undefined, { priceIn: 1 }), 0);
});

test('the model list: the prompt cache\'s prices, where the provider says them', async () => {
  script = json({ data: [
    { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000003', input_cache_write: '0.00000375' } },
    { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek', pricing: { prompt: '0.0000002', completion: '0.0000008' } },
  ] });
  const r = await adapter.models({ config: { provider: 'openrouter' }, secrets: { apiKey: 'k' } });
  assert.deepEqual(r.models.map(m => [m.priceIn, m.priceOut, m.priceCacheRead, m.priceCacheWrite]), [[3, 15, 0.3, 3.75], [0.2, 0.8, undefined, undefined]]);
});
