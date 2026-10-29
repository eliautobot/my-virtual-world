// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The built-in brains (docs/features/FREE-WILL.md §3, the Mind): a model provider the agent's owner (or the installation)
// connects with its own API key. Runs inside the provider helper process (./host-main.mjs): its environment holds none of
// the server's secrets and the key arrives with each call. The thinking itself (what to ask, what the answer may do) is
// the server's (server/mind/); this adapter makes one model call at a time.
// - complete: one chat completion — a system and a user message (or a short conversation) in, the model's text out, with the tokens it used and,
//   where the provider says it (OpenRouter), what it cost. json: true asks for a JSON object.
//   stream: true sends the answer as it is written (ctx.delta({ text }) and, where the model shows it, { thinking }) and
//   resolves with the whole of it; streamId lets abort() cut it off (the chat's Stop: the provider stops writing, and
//   billing, at once). A user turn may carry parts: images (any provider) and PDFs (OpenAI, OpenRouter, Anthropic).
//   model and thinking override the connection's for one call (the chat's model and effort pickers).
// - models: the provider's model list, for the pages' pickers. test: the smallest possible call, for Settings.
// - moderate: the provider's moderation service checks a text an agent would say in public (OpenAI's; no charge).
// Providers: OpenAI, OpenRouter, Google (its documented OpenAI-compatible endpoint) and any OpenAI-compatible server
// ("custom") through POST {base}/chat/completions; Anthropic through its Messages API. A custom server must be a public
// HTTPS address (checked when the connection is made, so a name that later points inside cannot reach in) unless the
// connection is an administrator's (the server says so: Connections.mayReachLocal — the installation's, or an
// administrator's own), which may name a server on the local network (Ollama, LM Studio, vLLM on this machine or the tailnet).
// Errors carry a code the server acts on (auth, quota, rate_limited, bad_request, refused, timeout, network, blocked,
// provider_error) and a message of our own: a provider's error text is never passed on (some repeat part of the key).
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { BUILTIN_MANIFESTS } from './manifest.js';

const manifest = BUILTIN_MANIFESTS.find(m => m.id === 'models');
const MAX_TIMEOUT_MS = 90000;
const MAX_OUT_TOKENS = 16000;
const MAX_BODY = 2 * 1048576;   // a provider's answer bigger than this is not read
const STREAM_IDLE_MS = 90000;   // a streamed answer with nothing new for this long has stalled
const STREAM_MAX_MS = 600000;   // … and no answer streams longer than this
const STREAM_TEXT_MAX = 100000; // characters of answer (and of reasoning) kept; past it the stream is cut
const THINKING = ['off', 'low', 'medium', 'high'];
// Room for thinking on top of the answer's own: a model's reasoning counts against its output limit (Anthropic's
// budget_tokens, OpenAI's max_completion_tokens, OpenRouter's max_tokens), so an answer given only its own room was cut
// off by the model's thinking (2026-10-08: a brain set to think high lost 45% of its agents' thoughts that way).
export const THINK_TOKENS = Object.freeze({ off: 0, low: 1024, medium: 4096, high: 8192 });
const streams = new Map();      // streamId → abort(): the streams in flight, for Stop
export const BASE = {   // (the tests point a provider at a local fake)
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  anthropic: 'https://api.anthropic.com/v1',
};
/** The model when the connection names none: each provider's small, fast one (the Mind writes short plans and notes). */
export const DEFAULT_MODEL = { openai: 'gpt-5.6-luna', openrouter: 'deepseek/deepseek-v4.1-flash', google: 'gemini-3.1-flash-lite', anthropic: 'claude-haiku-4-5-20251001' };

const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

// ------------------------------------------------------------------ where a custom server may be
/** Whether an address is outside the public internet (loopback, private, link-local and cloud metadata, carrier NAT,
 *  multicast, reserved; IPv4-mapped IPv6 judged as IPv4). */
export function privateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (m) return privateAddress(m[1]);
    return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s);
  }
  return true;
}
/** A DNS lookup for http(s).request that refuses private addresses (checked at connect time: a name that resolves to a
 *  public address now and a private one later is checked again on every connection). */
export function guardedLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }, (err, list) => {
    if (err) return cb(err);
    const ok = (list || []).filter(x => !privateAddress(x.address));
    if (!ok.length || ok.length !== list.length) return cb(fail('blocked', 'That server is not on the public internet'));
    if (options && options.all) return cb(null, ok);
    cb(null, ok[0].address, ok[0].family);
  });
}

/** Where the provider's API is, and whether the address must be public. */
function endpoint(p) {
  const c = p.config || {}, provider = c.provider || 'openai';
  if (provider !== 'custom') {
    if (!BASE[provider]) throw fail('bad_request', 'Unknown provider');
    return { provider, base: BASE[provider], guard: false };
  }
  let u;
  try { u = new URL(String(c.baseUrl || '')); } catch { throw fail('bad_request', 'The custom provider needs a base URL'); }
  const local = p.allowPrivate === true;   // (the server says so only for an administrator's connections)
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw fail('blocked', 'Your own model provider must use https: one on this network (http, a private or Tailscale address) is added by an administrator');
  if (u.username || u.password) throw fail('bad_request', 'Put the key in the API key field, not in the URL');
  // (an address written as a number is never looked up, so the lookup's check doesn't see it: checked here)
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!local && net.isIP(host) && privateAddress(host)) throw fail('blocked', 'That server is not on the public internet: one on this network (http, a private or Tailscale address) is added by an administrator');
  return { provider, base: u.href.replace(/\/+$/, ''), guard: !local };
}

/** One JSON request; resolves { status, json, headers }. */
function request(method, url, headers, body, { timeoutMs, guard }) {
  const u = new URL(url), lib = u.protocol === 'http:' ? http : https;
  const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = lib.request(u, {
      method, headers: { Accept: 'application/json', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...headers },
      ...(guard ? { lookup: guardedLookup, autoSelectFamily: false } : {}),
      timeout: timeoutMs,
    }, res => {
      const chunks = []; let size = 0;
      res.on('data', d => { size += d.length; if (size > MAX_BODY) { req.destroy(fail('provider_error', 'The answer was too large')); return; } chunks.push(d); });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { json = null; }
        resolve({ status: res.statusCode, json, headers: res.headers });
      });
      res.on('error', e => reject(e));
    });
    req.on('timeout', () => req.destroy(fail('timeout', `No answer within ${timeoutMs} ms`)));
    req.on('error', e => reject(e.code === 'blocked' || e.code === 'timeout' || e.code === 'provider_error' ? e : fail('network', 'The provider could not be reached')));
    if (data) req.write(data);
    req.end();
  });
}

/** The error for a provider's refusal, by status and error type. */
function refusal(res, what) {
  const j = res.json || {}, type = String((j.error && (j.error.code || j.error.type)) || j.type || '');
  if (res.status === 401 || res.status === 403) return fail('auth', 'The API key was refused');
  if (res.status === 402 || /insufficient_quota|credit|billing/.test(type)) return fail('quota', 'The provider account has no credit left');
  if (res.status === 429 || res.status === 529) {
    const ra = Number(res.headers && res.headers['retry-after']);
    return fail('rate_limited', 'The provider is limiting requests', { retryAfterMs: Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 300000) : 0 });
  }
  if (res.status === 400 || res.status === 404 || res.status === 413 || res.status === 422) return fail('bad_request', `The provider refused the request (HTTP ${res.status}) — check the model name`);
  return fail('provider_error', `${what} failed (HTTP ${res.status})`);
}
const num = v => (Number.isFinite(v) ? v : null);

/** A user turn's content: its text and parts (images, PDFs) in the provider's shape. */
function contentOf(t, provider) {
  const parts = Array.isArray(t.parts) ? t.parts.filter(x => x && typeof x.data === 'string' && x.data) : [];
  if (!parts.length) return t.text;
  const out = [];
  for (const x of parts) {
    if (x.type === 'image') {
      const mime = /^image\/(png|jpeg|gif|webp)$/.test(x.mime) ? x.mime : 'image/png';
      out.push(provider === 'anthropic' ? { type: 'image', source: { type: 'base64', media_type: mime, data: x.data } }
        : { type: 'image_url', image_url: { url: `data:${mime};base64,${x.data}` } });
    } else if (x.type === 'pdf') {
      if (provider === 'anthropic') out.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: x.data }, ...(x.name ? { title: String(x.name).slice(0, 120) } : {}) });
      else if (provider === 'openai' || provider === 'openrouter') out.push({ type: 'file', file: { filename: String(x.name || 'document.pdf').slice(0, 120), file_data: `data:application/pdf;base64,${x.data}` } });
      else throw fail('unsupported_file', 'This provider can\'t read PDF files here. Use OpenAI, OpenRouter or Anthropic, or paste the text.');
    }
  }
  if (t.text) out.push({ type: 'text', text: t.text });
  return out;
}

/** The request for one completion: where it goes, its headers and body, and how to read the answer. */
function build(p) {
  const key = (p.secrets && p.secrets.apiKey) || '';
  const { provider, base, guard } = endpoint(p);
  // (a server of one's own — Ollama, LM Studio, vLLM — often has no key: then none is sent)
  if (!key && provider !== 'custom') throw fail('auth', 'No API key is set for this connection');
  const c = p.config || {};
  const over = typeof p.model === 'string' && p.model.trim() ? p.model.trim() : '';
  if (over && (over.length > 200 || /[\s\u0000-\u001f\u007f]/.test(over))) throw fail('bad_request', 'That is not a model name');
  const model = over || String(c.model || DEFAULT_MODEL[provider] || '').trim();
  if (!model) throw fail('bad_request', 'No model is set for this connection');
  const system = String(p.system || '');
  const turns = Array.isArray(p.turns)
    ? p.turns.slice(-(Number(p.maxTurns) > 0 ? Math.min(200, Number(p.maxTurns)) : 12)).map(t => ({ role: t && t.role === 'assistant' ? 'assistant' : 'user', text: String((t && t.text) || ''), parts: t && t.role !== 'assistant' ? t.parts : undefined }))
    : [{ role: 'user', text: String(p.user || '') }];
  if (!turns.length || turns[turns.length - 1].role !== 'user' || turns.some(t => !t.text && !(Array.isArray(t.parts) && t.parts.length))) throw fail('bad_request', 'Nothing to ask');
  const maxTokens = Math.max(16, Math.min(MAX_OUT_TOKENS, Number(p.maxTokens) || 800));
  const temperature = Number.isFinite(p.temperature) ? Math.max(0, Math.min(2, p.temperature)) : 0.7;
  const thinking = THINKING.includes(p.thinking) ? p.thinking : THINKING.includes(c.thinking) ? c.thinking : 'off';
  const stream = !!p.stream;
  const messages = turns.map(t => ({ role: t.role, content: t.role === 'user' ? contentOf(t, provider) : t.text }));
  const hasPdf = turns.some(t => Array.isArray(t.parts) && t.parts.some(x => x && x.type === 'pdf'));
  if (provider === 'anthropic') {
    // the Messages API; a JSON answer by starting it with "{" (its documented way to shape the output — not allowed while
    // the model thinks, when the instruction alone asks for it). The 5-series thinks adaptively at an effort level.
    const adaptive = /claude-(?:[a-z]+-)?(?:5|fable)/.test(model);
    const think = THINK_TOKENS[thinking], prefill = !!p.json && !think && !stream;
    const body = { model, max_tokens: maxTokens + think, ...(system ? { system } : {}),
      messages: [...messages, ...(prefill ? [{ role: 'assistant', content: '{' }] : [])],
      ...(think ? (adaptive ? { thinking: { type: 'adaptive' }, output_config: { effort: thinking } } : { thinking: { type: 'enabled', budget_tokens: think } }) : { temperature }),
      ...(stream ? { stream: true } : {}) };
    return { provider, guard, model, prefill, url: `${base}/messages`, headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body };
  }
  const room = maxTokens + THINK_TOKENS[thinking];   // (the answer's, and its thinking's: see THINK_TOKENS)
  const body = {
    model, temperature,
    messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
    ...(provider === 'openai' ? { max_completion_tokens: room } : { max_tokens: room }),
    ...(p.json ? { response_format: { type: 'json_object' } } : {}),
    // OpenRouter: thinking on or off whatever the model's default, and the cost of the call in the answer; a PDF read
    // by its free text engine (a model that reads PDFs itself still gets the text)
    ...(provider === 'openrouter' ? { reasoning: thinking === 'off' ? { enabled: false } : { effort: thinking }, usage: { include: true } } : {}),
    ...(provider === 'openrouter' && hasPdf ? { plugins: [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }] } : {}),
    ...(provider === 'openai' && thinking !== 'off' ? { reasoning_effort: thinking } : {}),
    ...(stream ? { stream: true, ...(provider === 'openrouter' ? {} : { stream_options: { include_usage: true } }) } : {}),
  };
  return { provider, guard, model, prefill: false, url: `${base}/chat/completions`, headers: key ? { Authorization: `Bearer ${key}` } : {}, body };
}

/** p: { config: { provider, baseUrl, model, thinking }, secrets: { apiKey }, system, user, json, maxTokens, temperature, timeoutMs, allowPrivate }
 *  — or turns: [{ role: 'user'|'assistant', text, parts? }] instead of user, a conversation ending with a user message (a
 *  thought that uses tools: its earlier answers and the results it was given; a chat: its history and attachments).
 *  model / thinking: this call's own. stream + streamId: see the header (ctx.delta receives the pieces). */
async function complete(p, ctx = {}) {
  const r = build(p);
  const t0 = Date.now();
  if (p.stream) return await streamed(p, r, ctx, t0);
  const timeoutMs = Math.max(1000, Math.min(MAX_TIMEOUT_MS, Number(p.timeoutMs) || 30000));
  const res = await request('POST', r.url, r.headers, r.body, { timeoutMs, guard: r.guard });
  if (r.provider === 'anthropic') {
    if (res.status !== 200 || !res.json) throw refusal(res, 'The Anthropic API');
    const j = res.json, parts = Array.isArray(j.content) ? j.content.filter(x => x && x.type === 'text').map(x => x.text) : [];
    const text = (r.prefill ? '{' : '') + parts.join('');
    if (j.stop_reason === 'refusal') throw fail('refused', 'The model declined to answer');
    return { text, finish: j.stop_reason || null, model: j.model || r.model, ms: Date.now() - t0,
      usage: { in: num(j.usage && j.usage.input_tokens), out: num(j.usage && j.usage.output_tokens) }, costUsd: null };
  }
  if (res.status !== 200 || !res.json) throw refusal(res, 'The model provider');
  const j = res.json, ch = Array.isArray(j.choices) ? j.choices[0] : null;
  if (!ch || !ch.message) {
    if (j.error) throw refusal({ ...res, status: Number(j.error.code) || 502 }, 'The model provider');
    throw fail('provider_error', 'The model provider answered without a message');
  }
  if (ch.finish_reason === 'content_filter' || (ch.message.refusal && !ch.message.content)) throw fail('refused', 'The model declined to answer');
  const u = j.usage || {};
  return { text: typeof ch.message.content === 'string' ? ch.message.content : '', finish: ch.finish_reason || null, model: j.model || r.model, ms: Date.now() - t0,
    usage: { in: num(u.prompt_tokens), out: num(u.completion_tokens) }, costUsd: num(u.cost) };
}

/** A streamed completion (server-sent events): pieces to ctx.delta as they come, then the whole answer. */
function streamed(p, r, ctx, t0) {
  const id = typeof p.streamId === 'string' && p.streamId ? p.streamId.slice(0, 80) : null;
  const emit = d => { try { ctx.delta?.(d); } catch { /* the reader is gone */ } };
  const u = new URL(r.url), lib = u.protocol === 'http:' ? http : https;
  const data = Buffer.from(JSON.stringify(r.body));
  return new Promise((resolve, reject) => {
    let text = '', thinking = '', finish = null, model = r.model, usage = { in: null, out: null }, costUsd = null, settled = false, refused = false, cut = false;
    const done = (err, v) => {
      if (settled) return; settled = true;
      clearTimeout(cap); if (id) streams.delete(id);
      if (err) reject(err); else resolve(v);
    };
    const result = status => ({ text, thinking: thinking || undefined, finish: status || finish, model, ms: Date.now() - t0, usage, costUsd, ...(cut ? { cut: true } : {}) });
    const req = lib.request(u, {
      method: 'POST', headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', 'Content-Length': data.length, ...r.headers },
      ...(r.guard ? { lookup: guardedLookup, autoSelectFamily: false } : {}), timeout: STREAM_IDLE_MS,
    }, res => {
      if (res.statusCode !== 200) {   // an error is an ordinary JSON answer
        const chunks = []; let size = 0;
        res.on('data', d => { size += d.length; if (size <= MAX_BODY) chunks.push(d); });
        res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not JSON */ } done(refusal({ status: res.statusCode, json, headers: res.headers }, r.provider === 'anthropic' ? 'The Anthropic API' : 'The model provider')); });
        res.on('error', () => done(fail('network', 'The provider could not be reached')));
        return;
      }
      if (/application\/json/i.test(String(res.headers['content-type'] || ''))) {
        // a server that does not stream (some OpenAI-compatible ones ignore "stream"): its whole answer at once
        const chunks = []; let size = 0;
        res.on('data', d => { size += d.length; if (size <= MAX_BODY) chunks.push(d); });
        res.on('end', () => {
          let j = null; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not JSON */ }
          const ch = j && Array.isArray(j.choices) ? j.choices[0] : null;
          const parts = j && Array.isArray(j.content) ? j.content.filter(x => x && x.type === 'text').map(x => x.text) : null;
          const t = ch && ch.message && typeof ch.message.content === 'string' ? ch.message.content : parts ? parts.join('') : null;
          if (t === null) return done(j && j.error ? refusal({ status: Number(j.error.code) || 502, json: j, headers: res.headers }, 'The model provider') : fail('provider_error', 'The model provider answered without a message'));
          text = t.slice(0, STREAM_TEXT_MAX); if (text) emit({ text });
          if (j.model) model = j.model;
          finish = (ch && ch.finish_reason) || j.stop_reason || null;
          const u = j.usage || {};
          usage = { in: num(u.prompt_tokens ?? u.input_tokens), out: num(u.completion_tokens ?? u.output_tokens) }; costUsd = num(u.cost);
          done(null, result());
        });
        res.on('error', () => done(fail('network', 'The provider could not be reached')));
        return;
      }
      let buf = '';
      const piece = (k, v) => {
        if (!v) return;
        if (k === 'text') { if (text.length >= STREAM_TEXT_MAX) { cut = true; req.destroy(); return; } text += v; } else { if (thinking.length >= STREAM_TEXT_MAX) return; thinking += v; }
        emit({ [k]: v });
      };
      const line = l => {
        if (!l.startsWith('data:')) return;
        const raw = l.slice(5).trim();
        if (!raw || raw === '[DONE]') return;
        let j; try { j = JSON.parse(raw); } catch { return; }
        if (j.error || j.type === 'error') {
          const e = j.error || {}, code = Number(e.code) || (/overloaded/.test(String(e.type)) ? 529 : 502);
          req.destroy();
          return done(refusal({ status: code, json: { error: e }, headers: {} }, 'The model provider'));
        }
        if (r.provider === 'anthropic') {
          if (j.type === 'message_start' && j.message) { model = j.message.model || model; usage.in = num(j.message.usage && j.message.usage.input_tokens); }
          else if (j.type === 'content_block_delta' && j.delta) { if (j.delta.type === 'text_delta') piece('text', j.delta.text); else if (j.delta.type === 'thinking_delta') piece('thinking', j.delta.thinking); }
          else if (j.type === 'message_delta') { if (j.delta && j.delta.stop_reason) finish = j.delta.stop_reason; if (j.usage) usage.out = num(j.usage.output_tokens); if (finish === 'refusal') refused = true; }
          return;
        }
        if (j.model) model = j.model;
        const ch = Array.isArray(j.choices) ? j.choices[0] : null;
        if (ch) {
          const d = ch.delta || {};
          piece('thinking', typeof d.reasoning === 'string' ? d.reasoning : typeof d.reasoning_content === 'string' ? d.reasoning_content : '');
          piece('text', typeof d.content === 'string' ? d.content : '');
          if (ch.finish_reason) { finish = ch.finish_reason; if (finish === 'content_filter') refused = true; }
        }
        if (j.usage) { usage = { in: num(j.usage.prompt_tokens), out: num(j.usage.completion_tokens) }; if (num(j.usage.cost) !== null) costUsd = num(j.usage.cost); }
      };
      res.setEncoding('utf8');
      res.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); if (settled) return; } });
      res.on('end', () => { if (buf) line(buf); if (refused && !text) done(fail('refused', 'The model declined to answer')); else done(null, result()); });
      res.on('error', () => done(null, result('interrupted')));
      res.on('close', () => { if (!settled) done(null, result(cut ? 'length' : 'interrupted')); });
    });
    const cap = setTimeout(() => req.destroy(fail('timeout', 'The answer took too long')), STREAM_MAX_MS); cap.unref?.();
    if (id) streams.set(id, () => { req.destroy(); done(null, result('stopped')); });
    req.on('timeout', () => req.destroy(fail('timeout', `Nothing new from the provider for ${STREAM_IDLE_MS / 1000} s`)));
    req.on('error', e => {
      // the stream had begun: what was written stands (cut short); before that, the call failed
      if (text) return done(null, result(e.code === 'timeout' ? 'timeout' : 'interrupted'));
      done(e.code === 'blocked' || e.code === 'timeout' ? e : fail('network', 'The provider could not be reached'));
    });
    req.write(data);
    req.end();
  });
}

/**
 * p: { config, secrets, input, timeoutMs } — the provider's moderation service checks a text: { flagged, categories }.
 * OpenAI's (omni-moderation-latest; no charge) or an OpenAI-compatible server's that has one; other providers have none.
 */
async function moderate(p) {
  const key = (p.secrets && p.secrets.apiKey) || '';
  const { provider, base, guard } = endpoint(p);
  // (a server of one's own — Ollama, LM Studio, vLLM — often has no key: then none is sent)
  if (!key && provider !== 'custom') throw fail('auth', 'No API key is set for this connection');
  if (provider !== 'openai' && provider !== 'custom') throw fail('bad_request', 'This provider has no moderation service (use OpenAI)');
  const input = String(p.input || '').slice(0, 2000);
  if (!input) throw fail('bad_request', 'Nothing to check');
  const res = await request('POST', `${base}/moderations`, key ? { Authorization: `Bearer ${key}` } : {}, { model: provider === 'openai' ? 'omni-moderation-latest' : (String(p.config?.moderationModel || '') || 'omni-moderation-latest'), input },
    { timeoutMs: Math.max(1000, Math.min(30000, Number(p.timeoutMs) || 8000)), guard });
  if (res.status !== 200 || !res.json) throw refusal(res, 'The moderation service');
  const r = Array.isArray(res.json.results) ? res.json.results[0] : null;
  if (!r || typeof r.flagged !== 'boolean') throw fail('provider_error', 'The moderation service answered without a result');
  return { flagged: r.flagged, categories: Object.entries(r.categories || {}).filter(([, v]) => v === true).map(([k]) => String(k).slice(0, 40)).slice(0, 12) };
}

export default {
  manifest,
  complete,
  moderate,
  /** Stop: the stream streamId ends where it is (its answer so far resolves the complete() call, finish 'stopped'). */
  abort(p) { const f = streams.get(String(p.streamId || '')); if (f) f(); return { ok: !!f }; },
  async models(p) {
    const key = p.secrets && p.secrets.apiKey;
    const { provider, base, guard } = endpoint(p);
    const headers = provider === 'anthropic' ? { 'x-api-key': key || '', 'anthropic-version': '2023-06-01' } : key ? { Authorization: `Bearer ${key}` } : {};
    const res = await request('GET', `${base}/models`, headers, undefined, { timeoutMs: 15000, guard });
    if (res.status !== 200 || !res.json) throw refusal(res, 'Listing the models');
    const list = Array.isArray(res.json.data) ? res.json.data : Array.isArray(res.json.models) ? res.json.models : [];
    // what a model takes and costs, where the provider says (OpenRouter): the pickers mark models that see images or read files
    return { models: list.slice(0, 600).map(m => {
      const inp = m.architecture && Array.isArray(m.architecture.input_modalities) ? m.architecture.input_modalities : null;
      const pr = m.pricing || {}, pin = Number(pr.prompt), pout = Number(pr.completion);
      return { id: String(m.id || m.name || ''), label: String(m.name || m.display_name || m.id || '').slice(0, 120),
        ...(inp ? { images: inp.includes('image'), files: inp.includes('file') } : {}),
        ...(Number.isFinite(pin) && Number.isFinite(pout) ? { priceIn: Math.round(pin * 1e9) / 1000, priceOut: Math.round(pout * 1e9) / 1000 } : {}),
        ...(Number.isFinite(Number(m.context_length)) ? { context: Number(m.context_length) } : {}) };
    }).filter(m => m.id) };
  },
  async test(p) {
    try {
      // (a server of one's own — Ollama, LM Studio — may load the model first: a minute and more)
      const own = (p.config?.provider || 'openai') === 'custom';
      const r = await complete({ ...p, system: 'You answer with one word.', user: 'Say OK.', maxTokens: 16, temperature: 0, timeoutMs: own ? MAX_TIMEOUT_MS : 20000 });
      return { ok: true, detail: `${r.model} answered in ${r.ms} ms` };
    } catch (e) {
      if (e.code === 'timeout' && (p.config?.provider || 'openai') === 'custom') return { ok: false, error: e.message, code: e.code, fix: 'A model on your own server may still be loading, or be too big for it: test again in a minute, or try a smaller model.' };
      const fix = { auth: 'Paste a valid API key in the connection settings.', quota: 'Add credit to the provider account.', bad_request: 'Check the model name (and the base URL for a custom provider).',
        rate_limited: 'Wait a minute and test again.', blocked: 'Your own provider must be a public https address. One on this network (http, a private or Tailscale address) is added by an administrator, for everyone or for themselves.', refused: 'Try another model.' }[e.code] || 'Try again in a minute; if it keeps failing, check the provider\'s status page.';
      return { ok: false, error: e.message, code: e.code, fix };
    }
  },
};
