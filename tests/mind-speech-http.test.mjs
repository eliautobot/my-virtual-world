// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What agents say in public on a real server (docs/features/FREE-WILL.md §11.12): a player talks to an agent with a brain
// of its own → the routine's line at once, then its own words in its bubble for everyone - after the moderation service
// said yes; a flagged line, one with a link, or one that can't be checked is never shown (the routine's line stays);
// without a moderation service nothing is said in its own words; once every 20 s an agent; the record keeps what was said
// in public and why anything was not; the prompt holds nothing private.
// The brain and the moderation service are one fake OpenAI-compatible server on this machine.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startServer, ownerSession } from './helpers/server.mjs';

let s, owner, fake, agents, brain, moderator, ws;
const seen = [], says = [], F = { line: 'Hello!' };
const wait = ms => new Promise(r => setTimeout(r, ms));

before(async () => {
  fake = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; });
    req.on('end', () => {
      const j = b ? JSON.parse(b) : {};
      seen.push({ url: req.url, body: j });
      res.setHeader('content-type', 'application/json');
      if (req.url.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'fake' }] })); return; }
      if (req.url.endsWith('/moderations')) {
        if (F.moderation === 'down') { res.statusCode = 503; res.end('{}'); return; }
        res.end(JSON.stringify({ results: [{ flagged: /hate/i.test(j.input), categories: { hate: /hate/i.test(j.input), harassment: false } }] })); return;
      }
      const user = j.messages.filter(m => m.role === 'user')[0].content;
      const ans = /JSON: \{"say"/.test(user) ? { say: F.line } : {};
      res.end(JSON.stringify({ model: 'fake', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(ans) } }], usage: { prompt_tokens: 300, completion_tokens: 20 } }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => fake.on('listening', r));
  s = await startServer({ population: 260, agents: 5, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  const base = `http://127.0.0.1:${fake.address().port}/v1`;
  brain = (await owner.post('/api/connections', { kind: 'models', label: 'Brain', scope: 'installation', config: { provider: 'custom', baseUrl: base, model: 'fake' }, secrets: { apiKey: 'k' } })).json.id;
  moderator = (await owner.post('/api/connections', { kind: 'models', label: 'Moderation', scope: 'installation', config: { provider: 'custom', baseUrl: base, model: 'fake' }, secrets: { apiKey: 'k' } })).json.id;
  agents = (await owner.get('/api/agents')).json.agents;
  for (const a of agents) { await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' }); await owner.post('/api/agents/update', { id: a.id, connectionId: brain, nativeId: 'mind' }); }
  await owner.post('/api/clock', { skip: 10 });   // late morning: everyone is up
  // everyone watching the world sees the bubbles
  ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws');
  ws.onmessage = ev => { if (typeof ev.data === 'string') { const m = JSON.parse(ev.data); if (m.t === 'say') says.push(m); } };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
});
after(async () => { ws?.close(); await s?.stop(); fake?.close(); });

const thoughts = async a => (await owner.get(`/api/mind/thoughts?agent=${a.id}`)).json.thoughts.filter(t => t.kind === 'speech');
async function talkTo(a) {
  const p = (await owner.get(`/api/agent/${a.i}`)).json;
  const r = await owner.post('/api/talk', { i: a.i, x: p.pos.x + 1, z: p.pos.z });
  assert.equal(r.status, 200, r.text);
  return r.json;
}
async function until(fn, what, ms = 8000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`waited for ${what}`); await wait(100); } }

test('without a moderation service an agent says nothing in its own words; with one, its line follows the routine\'s for everyone', async () => {
  const a = agents[0];
  await owner.post('/api/mind/agent', { agent: a.id, cadence: 'daily' });
  const r0 = await talkTo(a);
  await wait(1200);
  assert.ok(says.some(m => m.i === a.i && m.text === r0.text), 'the routine\'s line, as before');
  assert.equal((await thoughts(a)).length, 0, 'no moderation service: not even a thought');
  assert.deepEqual((await owner.get(`/api/mind/agent?agent=${a.id}`)).json.status.does.includes('speech'), false);
  // the administrator names one
  assert.equal((await owner.post('/api/settings', { values: { 'mind.moderationConnection': String(moderator) } })).status, 200);
  assert.ok((await owner.get(`/api/mind/agent?agent=${a.id}`)).json.status.does.includes('speech'));
  const b = agents[1];
  await owner.post('/api/mind/agent', { agent: b.id, cadence: 'daily' });
  F.line = 'Oh hi, Owner! Lovely to see you.';
  const n0 = says.length, r = await talkTo(b);
  const mine = await until(() => says.slice(n0).find(m => m.i === b.i && m.text === F.line), 'its own line in its bubble');
  assert.ok(says.slice(n0).findIndex(m => m.i === b.i && m.text === r.text) < says.slice(n0).indexOf(mine), 'the routine\'s line first');
  assert.ok(mine.until > 0);
  const t = (await thoughts(b))[0];
  assert.deepEqual({ status: t.status, said: t.did.said, shown: t.did.shown, moderation: t.did.moderation, kind: t.did.kind }, { status: 'ok', said: F.line, shown: true, moderation: 'ok', kind: 'greet' });
  assert.equal(seen.filter(x => x.url.endsWith('/moderations')).at(-1).body.input, F.line, 'the service checked exactly what was said');
  // the prompt: only what anyone there could know
  const prompt = seen.filter(x => x.body?.messages).map(x => x.body.messages.find(m => m.role === 'user').content).reverse().find(u => /JSON: \{"say"/.test(u));
  assert.match(prompt, /«Owner» \(someone I know well\) walks up to me and says hello\./);
  assert.doesNotMatch(prompt, /MONEY|MY OPEN PLANS|I REMEMBER|PEOPLE I KNOW|WHAT IS WRONG/);
  // once every 20 s: talking again at once gives the routine's line only
  const n1 = (await thoughts(b)).length;
  await talkTo(b); await wait(1200);
  assert.equal((await thoughts(b)).length, n1);
});

test('a flagged line, a line with a link, or one that can\'t be checked is never shown', async () => {
  const cases = [['I hate Mondays, honestly.', 'blocked'], ['Find me at www.my-shop.com!', 'local'], ['Nice weather today.', 'unchecked']];
  for (const [k, [line, how]] of cases.entries()) {
    const a = agents[2 + k];
    await owner.post('/api/mind/agent', { agent: a.id, cadence: 'daily' });
    F.line = line; F.moderation = how === 'unchecked' ? 'down' : 'ok';
    const n0 = says.length;
    await talkTo(a);
    const t = await until(async () => (await thoughts(a))[0], `${how}: a thought`);
    await wait(300);
    assert.equal(t.did.shown, false, line);
    assert.equal(t.did.moderation, how);
    assert.equal(t.did.said, undefined, 'what was not said is not kept');
    assert.ok(!says.slice(n0).some(m => m.text === line), `${how}: nobody saw it`);
    if (how === 'blocked') assert.deepEqual(t.did.categories, ['hate']);
    if (how === 'local') assert.equal(t.did.reason, 'link');
  }
  F.moderation = 'ok';
  const ov = (await owner.get('/api/mind/overview')).json.speech;
  assert.equal(ov.moderator.id, moderator);
  assert.ok(ov.shown >= 1 && ov.blocked >= 1 && ov.local >= 1 && ov.unchecked >= 1, JSON.stringify(ov));
});
