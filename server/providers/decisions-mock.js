// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The mock decision service (Free Will tests and load tests). A test manifest: the registry only takes it when tests
// allow it, so it never appears in a real installation. Its settings script how it behaves:
//   latencyMs  how long each answer takes          failRate  share of calls that fail (0..1), chosen deterministically
//   behaviour  'spread' (a peaked distribution that depends on the input), 'first' (always the first option),
//              'refuse' (a refusal), 'garbage' (a choice that is not an option), 'hang' (never answers)
// The token count is estimated like the real service's (about 4 characters a token) so metering can be tested.
import crypto from 'node:crypto';

const manifest = {
  id: 'decisions-mock', label: 'Mock decisions', test: true, transport: 'network', connectionKind: 'remote',
  official: 'None: this is the test double the suite uses for decision services',
  fields: [
    { key: 'latencyMs', label: 'Latency (ms)', type: 'number', default: 20, min: 0, max: 60000 },
    { key: 'failRate', label: 'Failure rate', type: 'number', default: 0, min: 0, max: 1 },
    { key: 'behaviour', label: 'Behaviour', type: 'select', options: ['spread', 'first', 'refuse', 'garbage', 'hang'], default: 'spread' },
    { key: 'priceInPerMTok', label: 'Price per million input tokens (US$)', type: 'number', default: 0.1, min: 0, max: 1000 },
    { key: 'apiKey', label: 'API key', type: 'secret' },
  ],
  capabilities: { decisions: true },
};

const wait = ms => new Promise(r => setTimeout(r, ms));
const unit = (s, salt) => crypto.createHash('sha256').update(`${salt}|${s}`).digest().readUInt32BE(0) / 0x100000000;
let calls = 0;

function answer(q, input, behaviour) {
  if (behaviour === 'refuse') return { type: 'refusal', name: q.name };
  if (q.type === 'predicate') return { type: 'predicate', name: q.name, probability: Math.round(unit(input, q.name) * 100) / 100 };
  const choices = Array.isArray(q.choices) ? q.choices : [];
  if (!choices.length) return { type: 'refusal', name: q.name };
  if (behaviour === 'garbage') return { type: 'choice', name: q.name, choice: 'not-an-option', confidence: 0.9, probabilities: [{ value: 'not-an-option', probability: 1 }] };
  const top = behaviour === 'first' ? 0 : Math.floor(unit(input, `${q.name}:top`) * choices.length);
  const raw = choices.map((c, k) => (k === top ? 6 : 0.2 + unit(input, `${q.name}:${c.value}`)));
  const sum = raw.reduce((s, x) => s + x, 0);
  const probabilities = choices.map((c, k) => ({ value: c.value, probability: Math.round(raw[k] / sum * 1000) / 1000 }));
  return { type: 'choice', name: q.name, choice: choices[top].value, confidence: probabilities[top].probability, probabilities };
}

export default {
  manifest,
  async decide(p) {
    const c = p.config || {}, req = p.request || {};
    const n = ++calls;
    if (c.behaviour === 'hang') return new Promise(() => {});
    if (c.latencyMs > 0) await wait(c.latencyMs);
    if (c.failRate > 0 && unit(String(n), 'fail') < c.failRate) throw Object.assign(new Error('The mock decision service failed on purpose'), { code: 'provider_error' });
    const input = String(req.input || '');
    return {
      answers: (req.questions || []).map(q => answer(q, input, c.behaviour || 'spread')),
      model: 'mock-decider', ms: c.latencyMs || 0,
      usage: { inputTokens: Math.ceil(JSON.stringify(req).length / 4) },
    };
  },
  async test(p) { return p.secrets && p.secrets.apiKey === 'wrong' ? { ok: false, error: 'The API key was refused', code: 'auth', fix: 'Paste a valid key.' } : { ok: true, detail: 'Mock decisions reachable' }; },
  async calls() { return { calls }; },
};
