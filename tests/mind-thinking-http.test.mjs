// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A brain that thinks before it answers (its connection's Thinking - 2026-10-08: set to high, it lost 45% of its agents'
// thoughts, cut off by their own reasoning): its thinking gets room of its own on top of the answer's; a thought cut off
// anyway is asked once more at once without thinking, and the thought is kept; cut off without thinking, it is named
// cut_off (not "made no sense"). The fake brain behaves like such a model: given room to think, it may use all of it.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startServer, ownerSession } from './helpers/server.mjs';

let s, owner, fake, A, B, C, brain;
const seen = [];
let mode = 'roomy';   // roomy: answers in full · greedy: whatever the room, its thinking fills it · tight: cut off whatever
const FULL = JSON.stringify({ memories: [{ term: 'short', text: 'A quiet walk', importance: 2 }], thought: 'A calm day.' });

before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', d => { b += d; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'fake' }] })); return; }
      const j = JSON.parse(b || '{}'), user = j.messages.filter(m => m.role === 'user').map(m => m.content).join('\n');
      seen.push({ max: j.max_tokens, user });
      const thinks = j.max_tokens > 1000;   // (given room to think: see THINK_TOKENS)
      const cut = mode === 'tight' || (mode === 'greedy' && thinks);
      res.end(JSON.stringify({ model: 'fake', choices: [{ finish_reason: cut ? 'length' : 'stop', message: { role: 'assistant', content: cut ? FULL.slice(0, 30) : FULL } }],
        usage: { prompt_tokens: 50, completion_tokens: cut ? j.max_tokens : 40 } }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => fake.on('listening', r));
  s = await startServer({ population: 260, agents: 3, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  const agents = (await owner.get('/api/agents')).json.agents;
  for (const a of agents) await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' });
  const c = await owner.post('/api/connections', { kind: 'models', label: 'Thinking brain', scope: 'installation',
    config: { provider: 'custom', baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake', thinking: 'high', priceInPerMTok: 1, priceOutPerMTok: 2 }, secrets: { apiKey: 'k' } });
  assert.equal(c.status, 200, c.text);
  brain = c.json.id;
  [A, B, C] = agents;
  for (const a of [A, B, C]) assert.equal((await owner.post('/api/agents/update', { id: a.id, connectionId: brain, nativeId: 'mind' })).status, 200);
});
after(async () => { await s?.stop(); fake?.close(); });

const reflect = a => owner.post('/api/mind/think', { agent: a.id, kind: 'reflect' });
const latest = async a => (await owner.get(`/api/mind/thoughts?agent=${a.id}`)).json.thoughts[0];

test('thinking has room of its own: the answer\'s limit plus its thinking\'s', async () => {
  mode = 'roomy';
  const n = seen.length, r = await reflect(A);
  assert.equal(r.status, 200, r.text);
  assert.equal(seen.length, n + 1, 'one call');
  assert.equal(seen.at(-1).max, 700 + 8192, 'a reflection\'s 700 tokens and high thinking\'s 8,192');
  const t = await latest(A);
  assert.deepEqual([t.kind, t.status], ['reflect', 'ok']);
});

test('cut off by its own thinking anyway: asked once more at once without thinking - the thought is kept, both calls paid', async () => {
  mode = 'greedy';
  const n = seen.length, r = await reflect(B);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(seen.slice(n).map(x => x.max), [700 + 8192, 700], 'with thinking, then without');
  const t = await latest(B);
  assert.deepEqual([t.kind, t.status], ['reflect', 'ok'], JSON.stringify(t));
  assert.ok(t.tokens.out >= 700 + 8192, `both calls counted (${t.tokens.out} tokens out)`);
});

test('cut off without thinking: named cut_off, not "made no sense"; once, not again and again', async () => {
  mode = 'tight';
  assert.equal((await owner.post('/api/connections/update', { id: brain, config: { provider: 'custom', baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake', thinking: 'off', priceInPerMTok: 1, priceOutPerMTok: 2 } })).status, 200);
  const n = seen.length, r = await reflect(C);   // (C: an owner asks an agent to reflect at most once a minute)
  assert.equal(r.json.code, 'cut_off', r.text);
  assert.equal(seen.length, n + 1, 'no second try without thinking to fall back on');
  const t = await latest(C);
  assert.deepEqual([t.status, t.error], ['failed', 'cut_off']);
});
