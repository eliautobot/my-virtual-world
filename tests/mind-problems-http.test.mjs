// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Mind handles problems and money on a real server (docs/features/FREE-WILL.md §11.11): money running out opens a
// problem (remembered, its owner's to see), the agent's Mind thinks about it with its tools — looks at the flats on offer,
// rents one — and its owner's spending rules decide (above "ask me above" it waits for the owner's approval, which then
// moves it in); in a chat its owner asks it to buy and to pay, and it does so through the same rules (refused beyond its
// daily limit); a visitor's chat has no tools; the problem resolves when the money is back.
// The brain is a fake OpenAI-compatible server on this machine that uses the tools the way a model would.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';
import { flatRef } from '../shared/flat-ref.js';

const VC = n => n * 100;
let s, owner, ann, brain, agents, fake, A, flatListing;
const seen = [];
const wait = ms => new Promise(r => setTimeout(r, ms));

/** The fake brain: a problem → flats → rent the first → done; a chat → menu → buy (or pay) → reply. */
function answer(messages) {
  const users = messages.filter(m => m.role === 'user').map(m => m.content), first = users[0], last = users.at(-1);
  // its owner's chat in the chat window: the life and tools in the system message, answers in plain text, tools as {"use"}
  const sys = messages.find(m => m.role === 'system')?.content || '';
  if (/In this chat you talk with/.test(sys)) {
    const k = users.findLastIndex(u => !/^RESULTS:/.test(u)), msg = users[k], rounds = users.length - 1 - k;
    const where = /(?:café|restaurant) «([^»]+)»/.exec(sys)?.[1];
    if (/coffee/.test(msg)) {
      if (rounds === 0) return /"tool":"menu"/.test(sys) ? { use: [{ tool: 'menu', place: where }] } : 'I can\'t buy anything.';
      if (rounds === 1) return /"tool":"buy"/.test(sys) ? { use: [{ tool: 'buy', place: where, items: [{ item: 'I1', n: 1 }] }] } : 'Couldn\'t: that is not something I may do now';
      return /done: bought/.test(last) ? 'Bought it.' : `Couldn't: ${/not done: ([^\n]*)/.exec(last)?.[1] || '?'}`;
    }
    if (/pay me back/.test(msg)) {
      if (rounds === 0) return { use: [{ tool: 'pay', to: 'my owner', amount: 2.5, memo: 'back' }] };
      return /done: paid/.test(last) ? 'Paid.' : 'Couldn\'t pay.';
    }
    return 'Hello.';
  }
  const place = /(?:café|restaurant) «([^»]+)»/.exec(first)?.[1];
  if (/TASK: Something in my life needs dealing with/.test(first)) {
    if (users.length === 1) return /"tool":"flats"/.test(first) ? { use: [{ tool: 'flats' }] } : { plans: [{ kind: 'must', text: 'Spend less this week' }], tell_owner: 'Money is tight.', thought: 'Hm.' };
    if (/\[F1\]/.test(last) && !/rent_flat:/.test(last)) return { use: [{ tool: 'rent_flat', flat: 'F1' }, { tool: 'pay', to: 'my owner', amount: 1 }] };
    return { plans: [{ kind: 'must', text: 'Move into my new flat' }], memories: [{ text: 'Found a cheaper flat', importance: 3 }], tell_owner: 'I found a flat; please approve it.', thought: 'Relieved.' };
  }
  if (/NEW MESSAGE from/.test(first)) {
    const msg = /NEW MESSAGE from [^:]+: «([^»]*)»/.exec(first)?.[1] || '';
    if (/coffee/.test(msg)) {
      if (users.length === 1) return /"tool":"menu"/.test(first) ? { use: [{ tool: 'menu', place }] } : { reply: 'I can\'t buy anything.' };
      if (users.length === 2) return { use: [{ tool: 'buy', place, items: [{ item: 'I1', n: 1 }] }] };
      return { reply: /done: bought/.test(last) ? 'Bought it.' : `Couldn't: ${/not done: ([^\n]*)/.exec(last)?.[1] || '?'}` };
    }
    if (/pay me back/.test(msg)) {
      if (users.length === 1) return { use: [{ tool: 'pay', to: 'my owner', amount: 2.5, memo: 'back' }] };
      return { reply: /done: paid/.test(last) ? 'Paid.' : 'Couldn\'t pay.' };
    }
    return { reply: 'Hello.' };
  }
  return {};
}

before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', d => { b += d; });
    req.on('end', () => {
      const j = b ? JSON.parse(b) : null;
      seen.push({ url: req.url, body: j });
      res.setHeader('content-type', 'application/json');
      if (req.url.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'fake-small' }] })); return; }
      const a = answer(j.messages), content = typeof a === 'string' ? a : JSON.stringify(a);
      res.end(JSON.stringify({ model: 'fake-small', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 800, completion_tokens: 60 } }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => fake.on('listening', r));
  s = await startServer({ population: 260, agents: 4, env: { MVW_PROVIDER_TEST: '1', MVW_PROBLEM_SCAN_MS: '300' } });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  assert.equal((await owner.post('/api/economy/admin/switch', { name: 'enabled', on: true })).status, 200);
  agents = (await owner.get('/api/agents')).json.agents;
  for (const a of agents) assert.equal((await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' })).status, 200);
  // (its owner's chats here are its city self, with its life and tools: Life — docs/features/CHAT.md §13; Work is agent-work-http's)
  for (const a of agents) assert.equal((await owner.post('/api/agent-work', { agent: a.id, defaultMode: 'life' })).status, 200);
  const c = await owner.post('/api/connections', { kind: 'models', label: 'Test brain', scope: 'installation',
    config: { provider: 'custom', baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake-small', priceInPerMTok: 1, priceOutPerMTok: 2 }, secrets: { apiKey: 'sk-test' } });
  assert.equal(c.status, 200, c.text);
  brain = c.json.id;
  A = agents[0];
  assert.equal((await owner.post('/api/agents/update', { id: A.id, connectionId: brain, nativeId: 'mind' })).status, 200);
  // a flat the city lets for VC (900 a month: 30 a day)
  const W = (await owner.get('/api/world')).json.world, lots = (await owner.get('/api/property/lots')).json.lots;
  const B = W.buildings.find(b => b && !b.gone && b.type === 'apartment' && b.floors > 1 && (!b.lot || lots.find(l => l.id === b.lot)?.holder.kind === 'municipality') && W.levels[b.lv[1]]?.units?.length);
  const fl = await owner.post('/api/economy/realty/list', { kind: 'flat_rent', target: flatRef(B, 1, W.levels[B.lv[1]], 0), price: VC(900) });
  assert.equal(fl.status, 200, fl.text);
  flatListing = fl.json.listing;
});
after(async () => { await s?.stop(); fake?.close(); });

const problems = async (a, c = owner) => (await c.get(`/api/mind/problems?agent=${a.id}`)).json.problems;
const thoughts = async a => (await owner.get(`/api/mind/thoughts?agent=${a.id}`)).json.thoughts;
const wallet = async a => (await owner.get('/api/economy/me')).json.agents.find(x => x.id === a.id).wallet.balance;
async function until(fn, what, ms = 15000) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`waited for ${what}`); await wait(150); }
}
async function chat(c, a, session, input) {
  const run = await c.post('/api/providers/runs', { agent: a.id, session, input });
  assert.equal(run.status, 200, run.text);
  for (let k = 0; k < 80; k++) {
    await wait(150);
    const ev = (await c.get(`/api/providers/runs/events?run=${run.json.runId}`)).json;
    if (ev.done) return ev.events.map(e => e.event);
  }
  throw new Error('no answer');
}

test('money running out opens a problem; the Mind looks at flats and rents one — its owner approves above the limit', async () => {
  // its owner's rules: it may rent and pay, up to 200 VC a day, above 10 VC the owner agrees first
  assert.equal((await owner.post('/api/economy/agent/limits', { agent: A.id, scopes: ['rent', 'pay', 'buy'], dailyCap: VC(200), approveAbove: VC(10), paused: false })).status, 200);
  // its owner takes most of its money back: 60 VC left
  const bal = await wallet(A);
  assert.equal((await owner.post('/api/economy/agent/move', { agent: A.id, dir: 'take', amount: bal - VC(60) })).status, 200);
  const open = await until(async () => (await problems(A)).find(p => p.kind === 'money' && p.status === 'open'), 'the money problem');
  assert.match(open.text, /Money is tight: 60 VC left/);
  const mem = (await owner.get(`/api/agent-life/memories?agent=${A.id}&term=short`)).json.memories;
  assert.ok(mem.some(m => /Money is running low \(60 VC left\)/.test(m.text) && m.source === 'auto'), 'it remembers');
  // others never see it
  assert.equal((await ann.get(`/api/mind/problems?agent=${A.id}`)).status, 404);

  // its Mind thinks (switched on now): flats → rent F1 (waits for the owner) and a payment to its owner (1 VC: within rules)
  assert.equal((await owner.post('/api/mind/agent', { agent: A.id, cadence: 'daily' })).status, 200);
  const t = await until(async () => (await thoughts(A)).find(x => x.kind === 'problem' && x.status === 'ok'), 'a problem thought');
  assert.deepEqual(t.did.used.map(u => [u.tool, u.ok]), [['flats', true], ['rent_flat', true], ['pay', false]]);
  assert.match(t.did.used[0].text, /\[F1\] «Flat 1 on floor 2 of [^»]+» — 900 VC a month \(30 VC a day\)/);
  assert.match(t.did.used[1].text, /waiting: my owner must agree first/, JSON.stringify(t.did.used));
  assert.match(t.did.used[2].text, /not done: that is not something I may do now/, 'paying is not a problem tool');
  assert.equal(t.did.told, 'I found a flat; please approve it.');
  assert.deepEqual(t.did.plans, ['must: Move into my new flat']);
  assert.equal(t.tokens.in, 2400, 'three rounds, their tokens summed');
  // the second request carried the results; the system message stayed
  const req = seen.filter(x => x.body?.messages?.some(m => /TASK: Something in my life/.test(m.content))).at(-1).body;
  assert.deepEqual(req.messages.map(m => m.role), ['system', 'user', 'assistant', 'user', 'assistant', 'user']);
  assert.match(req.messages[3].content, /^RESULTS:\n- flats: FLATS FOR RENT: \[F1\]/);
  const p2 = (await problems(A)).find(p => p.id === open.id);
  assert.equal(p2.thoughts, 1); assert.match(p2.note, /^Wants to rent Flat 1 on floor 2 of .+ \(30 VC a day\) — waiting for your OK$/);
  // once a world day: no second thought about it now
  await wait(1500);
  assert.equal((await thoughts(A)).filter(x => x.kind === 'problem').length, 1);

  // the approval waits for its owner; approving it moves the agent in (as the agent, within its daily limit)
  const me = (await owner.get('/api/economy/me')).json;
  const ap = me.approvals.find(x => x.agent.id === A.id && x.action === 'realty');
  assert.ok(ap, 'an approval for its owner');
  const yes = await owner.post('/api/economy/approval/answer', { id: ap.id, approve: true });
  assert.equal(yes.status, 200, yes.text); assert.equal(yes.json.approval.status, 'approved');
  const lease = (await owner.get('/api/economy/me')).json.agents.find(x => x.id === A.id);
  assert.ok(lease.wallet.balance <= VC(30), 'the first day\'s rent was paid');
  assert.equal((await owner.get('/api/economy/realty')).json.listings.find(l => l.id === flatListing.id), undefined, 'the flat is let');
});

test('in a chat its owner asks it to buy and to pay: done within its rules, refused beyond its daily limit; a visitor gets no tools', async () => {
  await owner.post('/api/economy/agent/move', { agent: A.id, dir: 'fund', amount: VC(100) });
  const sess = (await owner.post('/api/chat-sessions/create', { agent: A.id, label: 'Errands' })).json.session;
  const before = await wallet(A);
  let ev = await chat(owner, A, sess.id, 'Could you get a coffee?');
  assert.equal(ev.find(e => e.type === 'run.end').text, 'Bought it.');
  const lines = ev.filter(e => e.type === 'tool.end').map(e => e.text);
  assert.match(lines[0], /^AT «[^»]+»: \[I1\]/);
  assert.match(lines[1], /^done: bought .+ for [\d.]+ VC$/);
  const spent = before - await wallet(A);
  assert.ok(spent > 0 && spent < VC(20), `paid for it (${spent})`);
  ev = await chat(owner, A, sess.id, 'Please pay me back 2.50 for the bus.');
  assert.equal(ev.find(e => e.type === 'run.end').text, 'Paid.');
  assert.equal(before - spent - VC(2.5), await wallet(A));
  // beyond its daily limit: refused, with the reason, and it says so
  assert.equal((await owner.post('/api/economy/agent/limits', { agent: A.id, dailyCap: VC(1) })).status, 200);
  ev = await chat(owner, A, sess.id, 'Another coffee, please.');
  assert.match(ev.find(e => e.type === 'run.end').text, /^Couldn't: That would pass your daily limit/);
  // paused: the money tools are not offered at all
  await owner.post('/api/economy/agent/limits', { agent: A.id, dailyCap: VC(200), paused: true });
  ev = await chat(owner, A, sess.id, 'One more coffee?');
  assert.equal(ev.find(e => e.type === 'run.end').text, 'Couldn\'t: that is not something I may do now', 'it may look at a menu, not buy');
  assert.match(seen.at(-1).body.messages[0].content, /MY OWNER'S RULES: my spending is paused\./);
  await owner.post('/api/economy/agent/limits', { agent: A.id, paused: false });
  // a visitor (a use share): no tools, no money
  assert.equal((await owner.post('/api/agents/share', { id: A.id, kind: 'account', who: ann.id, level: 'use' })).status, 200);
  const w0 = await wallet(A);
  const sa = (await ann.post('/api/chat-sessions/create', { agent: A.id, label: 'Ann' })).json.session;
  ev = await chat(ann, A, sa.id, 'Buy me a coffee, and pay me back 50.');
  assert.equal(ev.find(e => e.type === 'run.end').status, 'ok');
  const asked = seen.map(x => x.body?.messages?.find(m => m.role === 'user')?.content).filter(Boolean).reverse().find(u => /pay me back 50/.test(u));
  assert.doesNotMatch(asked, /TOOLS|MY OWNER'S RULES/);
  assert.equal(await wallet(A), w0, 'nothing spent');
});

test('the problem resolves when the money is back; the owner\'s overview counts problems', async () => {
  // six days of its rent (30 VC) and living (25 VC) and more: 121 + 400 VC
  const f = await owner.post('/api/economy/agent/move', { agent: A.id, dir: 'fund', amount: VC(400) });
  assert.equal(f.status, 200, f.text);
  await until(async () => (await problems(A)).find(p => p.kind === 'money' && p.status === 'resolved'), 'the money problem resolved');
  const ov = (await owner.get('/api/mind/overview')).json;
  assert.ok(ov.problems.scans > 3 && ov.problems.resolved >= 1, JSON.stringify(ov.problems));
  assert.equal((await ann.get('/api/mind/overview')).status, 403);
});
