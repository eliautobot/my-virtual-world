// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The TypeSafe adapter (Free Will, docs/features/FREE-WILL.md §2.6): TypeSafe's System One models — Jev — answer the
// questions Free Will asks with typed judgments and probabilities, as OpenAI's Decisions do (./openai-decisions.js). Runs
// inside the provider helper process (./host-main.mjs): its environment holds none of the server's secrets and the API key
// arrives with each call.
// - decide: one POST /v1/systemone (https://docs.typesafe.ai/api/system-one.md). The request Free Will builds is the
//   Decisions shape ({ input, questions: [{ type: 'choice'|'predicate'|'score', name, instructions, choices }] }); here it
//   becomes System One's ({ state, questions: { name: { type: 'choice'|'noul'|'score', instructions, criteria } } }) and
//   the answers come back in the Decisions shape, so Free Will and everything that asks it read one shape.
// - test: the smallest possible decision, to check the key and the model from Settings → Connections.
// Errors carry a code the server acts on (auth, quota, rate_limited, bad_request, timeout, network, provider_error) and
// a message of our own: the service's own error text is never passed on whole.
import { BUILTIN_MANIFESTS } from './manifest.js';

const DEFAULT_URL = 'https://api.typesafe.ai';
const MAX_TIMEOUT_MS = 15000;
const MAX_CHOICES = 255, MAX_LEVELS = 10;
const manifest = BUILTIN_MANIFESTS.find(m => m.id === 'typesafe-decisions');
// (TypeSafe's edge refuses a request without an ordinary client's signature: 403 / error 1010)
const UA = 'MyVirtualWorld/2 (Free Will)';

const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const name = v => String(v ?? '').slice(0, 64);

/** The Decisions shape → System One's: { state, questions }. Throws bad_request on a question it cannot ask. */
export function toSystemOne(req, model) {
  const questions = {};
  for (const q of req.questions) {
    const n = name(q && q.name);
    if (!n || questions[n]) throw fail('bad_request', 'Each question needs its own name');
    const instructions = String(q.instructions || '').slice(0, 4000);
    if (q.type === 'choice') {
      const list = (Array.isArray(q.choices) ? q.choices : []).slice(0, MAX_CHOICES);
      if (!list.length) throw fail('bad_request', `Question ${n} has no choices`);
      const criteria = {};
      for (const c of list) { const v = name(c && c.value); if (v && !(v in criteria)) criteria[v] = String(c.description || v).slice(0, 2000); }
      questions[n] = { type: 'choice', instructions, criteria };
    } else if (q.type === 'predicate' || q.type === 'noul') {
      questions[n] = { type: 'noul', instructions, ...(q.criteria && typeof q.criteria === 'object' ? { criteria: { true: String(q.criteria.true ?? 'Yes').slice(0, 2000), false: String(q.criteria.false ?? 'No').slice(0, 2000) } } : {}) };
    } else if (q.type === 'score') {
      const levels = (Array.isArray(q.levels) ? q.levels : Array.isArray(q.criteria) ? q.criteria : []).slice(0, MAX_LEVELS).map(x => String(x).slice(0, 2000));
      if (levels.length < 2) throw fail('bad_request', `Question ${n} needs at least two levels`);
      questions[n] = { type: 'score', instructions, criteria: levels };
    } else throw fail('bad_request', `Question ${n}: an unknown kind of question`);
  }
  return { model: model || 'jev-latest', state: String(req.input), questions };
}

/** System One's answers → the Decisions shape: [{ type: 'choice', name, choice, probabilities: [{ value, probability }],
 *  confidence } | { type: 'predicate', name, probability } | { type: 'score', name, score, probabilities, confidence }]. */
export function fromSystemOne(answers) {
  const out = [];
  for (const [n, a] of Object.entries(answers || {})) {
    if (!a || typeof a !== 'object') continue;
    if (a.type === 'choice' && typeof a.choice === 'string') {
      out.push({ type: 'choice', name: n, choice: a.choice, confidence: Number.isFinite(a.confidence) ? a.confidence : null,
        probabilities: Object.entries(a.probabilities || {}).filter(([, p]) => Number.isFinite(p)).map(([value, probability]) => ({ value, probability })) });
    } else if (a.type === 'noul' && Number.isFinite(a.noul)) {
      out.push({ type: 'predicate', name: n, probability: a.noul });
    } else if (a.type === 'score' && Number.isFinite(a.score)) {
      out.push({ type: 'score', name: n, score: a.score, confidence: Number.isFinite(a.confidence) ? a.confidence : null,
        probabilities: Object.entries(a.probabilities || {}).filter(([, p]) => Number.isFinite(p)).map(([value, probability]) => ({ value, probability })) });
    }
  }
  return out;
}

async function post(p, body, timeoutMs) {
  const key = p.secrets && p.secrets.apiKey;
  if (!key) throw fail('auth', 'No API key is set for this connection');
  const base = String((p.config && p.config.baseUrl) || DEFAULT_URL).replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) throw fail('bad_request', 'The address must start with https://');
  const ms = Math.max(200, Math.min(MAX_TIMEOUT_MS, Number(timeoutMs) || 8000));
  let res;
  try {
    res = await fetch(`${base}/v1/systemone`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw fail('timeout', `No answer within ${ms} ms`);
    throw fail('network', 'TypeSafe could not be reached');
  }
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  if (res.ok && json && json.answers && typeof json.answers === 'object') return json;
  if (res.status === 401 || (res.status === 403 && !/1010/.test(JSON.stringify(json || '')))) throw fail('auth', 'The API key was refused');
  if (res.status === 403) throw fail('provider_error', 'TypeSafe refused the request at its edge (error 1010)');
  if (res.status === 402) throw fail('quota', 'The TypeSafe account has no credit left');
  if (res.status === 429) {
    const ra = Number(res.headers.get('retry-after'));
    throw fail('rate_limited', 'TypeSafe is limiting requests', { retryAfterMs: Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 300000) : 0 });
  }
  if (res.status === 400 || res.status === 404 || res.status === 422) throw fail('bad_request', `TypeSafe refused the request (HTTP ${res.status})`);
  if (res.ok) throw fail('provider_error', 'TypeSafe answered without answers');
  throw fail('provider_error', `TypeSafe failed (HTTP ${res.status})`);
}

export default {
  manifest,
  /** p: { config: { model, baseUrl? }, secrets: { apiKey }, request: { input, questions }, timeoutMs } */
  async decide(p) {
    const req = p.request || {};
    if (typeof req.input !== 'string' || !Array.isArray(req.questions) || !req.questions.length) throw fail('bad_request', 'A decision needs input and questions');
    const t0 = Date.now();
    const json = await post(p, toSystemOne(req, p.config && p.config.model), p.timeoutMs);
    const u = json.usage || {};
    return { answers: fromSystemOne(json.answers), model: json.model || null, ms: Date.now() - t0,
      usage: { inputTokens: Number.isFinite(u.input_tokens) ? u.input_tokens : null, outputTokens: Number.isFinite(u.output_tokens) ? u.output_tokens : null } };
  },
  async test(p) {
    try {
      const r = await this.decide({ ...p, timeoutMs: 10000, request: { input: 'The sky is blue today.', questions: [{ type: 'predicate', name: 'about_sky', instructions: 'Is this sentence about the sky?' }] } });
      const a = r.answers.find(x => x && x.name === 'about_sky');
      if (!a || a.type !== 'predicate') return { ok: false, error: 'TypeSafe answered in an unexpected shape', fix: 'Check the model name in the connection settings.' };
      return { ok: true, detail: `TypeSafe reachable (${r.model || (p.config && p.config.model) || 'jev-latest'}, ${r.ms} ms)` };
    } catch (e) {
      const fix = { auth: 'Paste a valid TypeSafe API key in the connection settings.', quota: 'Add credit to the TypeSafe account.',
        bad_request: 'Check the model name in the connection settings (jev-latest).', rate_limited: 'Wait a minute and test again.' }[e.code] || 'Try again in a minute.';
      return { ok: false, error: e.message, code: e.code, fix };
    }
  },
};
