// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The chat window's model calls (server/providers/models.js, docs/features/CHAT.md §1): an answer streamed as it is
// written (OpenAI-compatible and Anthropic server-sent events), the reasoning a model shows, what it used and cost;
// Stop ends the stream at once with what was written; a stream that fails part-way keeps what came; images and PDFs
// in each provider's shape; the chat's own model and effort.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import adapter, { BASE } from '../../server/providers/models.js';

let srv, url;
const reqs = [];
let script = null;          // (req, res, body) => void — how the fake answers the next call
let closed = 0;             // calls the client broke off
before(async () => {
  srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', d => { b += d; });
    req.on('end', () => {
      const body = b ? JSON.parse(b) : null;
      reqs.push({ url: req.url, headers: req.headers, body });
      res.on('close', () => { if (!res.writableEnded) closed++; });
      script(req, res, body);
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => srv.on('listening', r));
  url = `http://127.0.0.1:${srv.address().port}`;
  for (const k of ['openai', 'openrouter', 'google', 'anthropic']) BASE[k] = `${url}/${k}`;
});
after(() => srv.close());

const sse = (res, events, { gap = 0, end = true } = {}) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  let i = 0;
  const next = () => {
    if (i >= events.length) { if (end) res.end(); return; }
    res.write(`data: ${typeof events[i] === 'string' ? events[i] : JSON.stringify(events[i])}\n\n`); i++;
    if (gap) setTimeout(next, gap); else next();
  };
  next();
};
const delta = (content, extra = {}) => ({ model: 'm-live', choices: [{ delta: { content, ...extra } }] });
const call = (provider, o = {}, onDelta = null) => adapter.complete({ config: { provider, model: 'm' }, secrets: { apiKey: 'sk-S' }, system: 'S',
  turns: o.turns || [{ role: 'user', text: 'U' }], stream: true, streamId: o.streamId, model: o.model, thinking: o.thinking, maxTokens: 500, timeoutMs: 5000 },
{ delta: d => onDelta && onDelta(d) });

test('OpenAI-compatible: pieces as written, reasoning apart, the usage and cost at the end; the call asks to stream', async () => {
  script = (req, res) => sse(res, [delta('', { reasoning: 'Let me think. ' }), delta('Hel'), delta('lo **world**'),
    { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: 7, cost: 0.00012 } }, '[DONE]']);
  const got = [];
  const r = await call('openrouter', {}, d => got.push(d));
  assert.deepEqual(got, [{ thinking: 'Let me think. ' }, { text: 'Hel' }, { text: 'lo **world**' }]);
  assert.deepEqual({ text: r.text, thinking: r.thinking, finish: r.finish, model: r.model, in: r.usage.in, out: r.usage.out, cost: r.costUsd },
    { text: 'Hello **world**', thinking: 'Let me think. ', finish: 'stop', model: 'm-live', in: 40, out: 7, cost: 0.00012 });
  const q = reqs.at(-1).body;
  assert.equal(q.stream, true); assert.equal(q.stream_options, undefined, 'OpenRouter: usage via its own flag');
  await call('openai', {});
  assert.deepEqual(reqs.at(-1).body.stream_options, { include_usage: true });
});

test('Anthropic: text and thinking deltas, usage from start and end; the 5-series thinks adaptively at an effort', async () => {
  script = (req, res) => sse(res, [{ type: 'message_start', message: { model: 'claude-x', usage: { input_tokens: 21 } } },
    { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Hmm.' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Bonjour' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }, { type: 'message_stop' }]);
  const got = [];
  const r = await call('anthropic', { thinking: 'high', model: 'claude-sonnet-5-5' }, d => got.push(d));
  assert.deepEqual(got, [{ thinking: 'Hmm.' }, { text: 'Bonjour' }]);
  assert.deepEqual({ text: r.text, in: r.usage.in, out: r.usage.out, model: r.model, finish: r.finish }, { text: 'Bonjour', in: 21, out: 3, model: 'claude-x', finish: 'end_turn' });
  const q = reqs.at(-1).body;
  assert.equal(q.model, 'claude-sonnet-5-5', 'the chat\'s own model');
  assert.deepEqual([q.thinking, q.output_config, q.stream], [{ type: 'adaptive' }, { effort: 'high' }, true]);
  await call('anthropic', { thinking: 'low', model: 'claude-haiku-4-5-20251001' });
  assert.deepEqual(reqs.at(-1).body.thinking, { type: 'enabled', budget_tokens: 1024 }, 'an older model: a budget');
});

test('Stop: the stream ends at once, the provider is let go, what was written is the answer', async () => {
  script = (req, res) => sse(res, Array.from({ length: 200 }, (_, i) => delta(`w${i} `)), { gap: 10, end: true });
  const got = [];
  const p = call('openai', { streamId: 'r1:0' }, d => got.push(d));
  await new Promise(r => setTimeout(r, 120));
  const before = closed;
  assert.deepEqual(adapter.abort({ streamId: 'r1:0' }), { ok: true });
  const r = await p;
  assert.equal(r.finish, 'stopped');
  assert.ok(r.text.startsWith('w0 w1 ') && r.text.length < 200 * 3, 'part of it');
  assert.equal(r.text, got.map(d => d.text).join(''), 'exactly what was shown');
  await new Promise(r => setTimeout(r, 50));
  assert.ok(closed > before, 'the connection to the provider was closed (it stops writing, and billing)');
  assert.deepEqual(adapter.abort({ streamId: 'r1:0' }), { ok: false }, 'once');
});

test('a stream that breaks part-way keeps what came; an error before any text is a failure in our words', async () => {
  script = (req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(`data: ${JSON.stringify(delta('Partial'))}\n\n`); setTimeout(() => res.destroy(), 20); };
  const r = await call('openai');
  assert.equal(r.text, 'Partial'); assert.equal(r.finish, 'interrupted');
  script = (req, res) => sse(res, [{ error: { message: 'secret detail sk-S', code: 429 } }]);
  await assert.rejects(call('openrouter'), e => e.code === 'rate_limited' && !/sk-S/.test(e.message));
  script = (req, res) => { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'bad key sk-S' } })); };
  await assert.rejects(call('openai'), e => e.code === 'auth' && !/sk-S/.test(e.message));
});

test('a server that ignores "stream" answers with plain JSON: read all the same', async () => {
  script = (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ model: 'plain', choices: [{ finish_reason: 'stop', message: { content: 'Whole answer' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } })); };
  const got = [];
  const r = await call('openai', {}, d => got.push(d));
  assert.deepEqual([r.text, r.model, r.usage.in, got.length], ['Whole answer', 'plain', 3, 1]);
});

test('attachments: images and PDFs in each provider\'s shape, the text after them; Google refuses a PDF in our words', async () => {
  script = (req, res) => sse(res, [delta('ok'), '[DONE]']);
  const turns = [{ role: 'user', text: 'What is this?', parts: [{ type: 'image', mime: 'image/png', data: 'iVBOR' }, { type: 'pdf', name: 'a.pdf', data: 'JVBER' }] }];
  await call('openrouter', { turns });
  let q = reqs.at(-1).body;
  assert.deepEqual(q.messages[1].content, [{ type: 'image_url', image_url: { url: 'data:image/png;base64,iVBOR' } },
    { type: 'file', file: { filename: 'a.pdf', file_data: 'data:application/pdf;base64,JVBER' } }, { type: 'text', text: 'What is this?' }]);
  assert.deepEqual(q.plugins, [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }], 'OpenRouter reads a PDF with its free engine');
  script = (req, res) => sse(res, [{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }]);
  await call('anthropic', { turns });
  q = reqs.at(-1).body;
  assert.deepEqual(q.messages[0].content.slice(0, 2), [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } },
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBER' }, title: 'a.pdf' }]);
  await assert.rejects(call('google', { turns }), e => e.code === 'unsupported_file');
  await assert.rejects(call('openai', { model: 'bad model name' }), e => e.code === 'bad_request');
});
