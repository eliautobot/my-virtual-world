// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The OpenAI Decisions adapter (Free Will, docs/features/FREE-WILL.md §2.6). Runs inside the provider helper process
// (./host-main.mjs): its environment holds none of the server's secrets and the API key arrives with each call.
// - decide: one POST /v1/decisions with the snapshot and the questions the server built; answers come back typed (a
//   choice from the given options with its probabilities, a probability, a score) or as a refusal.
// - test: the smallest possible decision, to check the key and the model from Settings → Connections.
// Errors carry a code the server acts on (auth, quota, rate_limited, bad_request, timeout, network, provider_error) and
// a message of our own: OpenAI's own error text is never passed on, because some of it repeats part of the key.
import { BUILTIN_MANIFESTS } from './manifest.js';

const ENDPOINT = 'https://api.openai.com/v1/decisions';
const MAX_TIMEOUT_MS = 15000;
const manifest = BUILTIN_MANIFESTS.find(m => m.id === 'openai-decisions');

const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

async function post(p, body, timeoutMs) {
  const key = p.secrets && p.secrets.apiKey;
  if (!key) throw fail('auth', 'No API key is set for this connection');
  const ms = Math.max(200, Math.min(MAX_TIMEOUT_MS, Number(timeoutMs) || 8000));
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw fail('timeout', `No answer within ${ms} ms`);
    throw fail('network', 'The Decisions API could not be reached');
  }
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  if (res.ok && json && Array.isArray(json.answers)) return json;
  const type = json && json.error && (json.error.code || json.error.type);
  if (res.status === 401 || res.status === 403) throw fail('auth', 'The API key was refused');
  if (res.status === 402 || type === 'insufficient_quota' || type === 'credit_balance_exhausted') throw fail('quota', 'The OpenAI account has no credit left');
  if (res.status === 429) {
    const ra = Number(res.headers.get('retry-after'));
    throw fail('rate_limited', 'OpenAI is limiting requests', { retryAfterMs: Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 300000) : 0 });
  }
  if (res.status === 400 || res.status === 404 || res.status === 422) throw fail('bad_request', `The Decisions API refused the request (HTTP ${res.status})`);
  if (res.ok) throw fail('provider_error', 'The Decisions API answered without answers');
  throw fail('provider_error', `The Decisions API failed (HTTP ${res.status})`);
}

export default {
  manifest,
  /** p: { config: { model }, secrets: { apiKey }, request: { input, questions }, timeoutMs } */
  async decide(p) {
    const req = p.request || {};
    if (typeof req.input !== 'string' || !Array.isArray(req.questions) || !req.questions.length) throw fail('bad_request', 'A decision needs input and questions');
    const t0 = Date.now();
    const json = await post(p, { model: (p.config && p.config.model) || 'gpt-6-luna', input: req.input, questions: req.questions }, p.timeoutMs);
    const u = json.usage || {};
    return { answers: json.answers, model: json.model || null, ms: Date.now() - t0, usage: { inputTokens: Number.isFinite(u.input_tokens) ? u.input_tokens : null } };
  },
  async test(p) {
    try {
      const r = await this.decide({ ...p, timeoutMs: 10000, request: { input: 'The sky is blue today.', questions: [{ type: 'predicate', name: 'about_sky', instructions: 'Is this sentence about the sky?' }] } });
      const a = r.answers.find(x => x && x.name === 'about_sky');
      if (!a || a.type !== 'predicate') return { ok: false, error: 'The Decisions API answered in an unexpected shape', fix: 'Check the model name in the connection settings.' };
      return { ok: true, detail: `Decisions API reachable (${r.model || (p.config && p.config.model) || 'gpt-6-luna'}, ${r.ms} ms)` };
    } catch (e) {
      const fix = { auth: 'Paste a valid OpenAI API key in the connection settings.', quota: 'Add credit to the OpenAI account (platform.openai.com → Billing).',
        bad_request: 'Check the model name in the connection settings.', rate_limited: 'Wait a minute and test again.' }[e.code] || 'Try again in a minute; if it keeps failing, check status.openai.com.';
      return { ok: false, error: e.message, code: e.code, fix };
    }
  },
};
