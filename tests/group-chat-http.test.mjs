// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A group conversation (server/chat/groups.js): what the person says in it, and what each agent answers, is one thread —
// the agent who speaks later is told what was said before, by the person, by the others and by itself ("You"), in order;
// whatever its senses (its phone: none); only agents the person may chat with, the run's own among them, at most 8; and
// the next member, started the moment the one before is done, already hears its answer.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann, fake, agents, seen, ws;
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 10000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(50); } };
const NOTE = /^\[My Virtual World — [\s\S]*?\]\n\n/;
const textOf = c => (typeof c === 'string' ? c : (c || []).filter(p => p.type === 'text').map(p => p.text).join('\n'));

before(async () => {
  seen = [];
  fake = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; });
    req.on('end', () => {
      const j = b ? JSON.parse(b) : {};
      res.setHeader('content-type', 'application/json');
      if (req.url.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'fake' }] })); return; }
      seen.push(j);
      const last = textOf(j.messages?.at(-1)?.content), words = last.replace(NOTE, '');
      const me = /You are «([^»]+)»/.exec(String(j.messages?.[0]?.content || ''))?.[1] || '?';
      // (say:<token> — an answer that says who answered which line: the thread's order can be read back)
      const content = /What did they say\?/.test(words) ? 'They said hello to us.' : /^say:(\S+)/.test(words) ? `ok:${/^say:(\S+)/.exec(words)[1]}:${me}` : 'Hello, both of you.';
      if (!j.stream) { res.end(JSON.stringify({ model: 'fake', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: ' + JSON.stringify({ model: 'fake', choices: [{ delta: { content } }] }) + '\n\n');
      res.end('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) + '\n\ndata: [DONE]\n\n');
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => fake.on('listening', r));
  s = await startServer({ population: 100, agents: 3, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  const c = await owner.post('/api/connections', { kind: 'models', label: 'Test brain', scope: 'installation',
    config: { provider: 'custom', baseUrl: 'http://127.0.0.1:' + fake.address().port + '/v1', model: 'fake' }, secrets: { apiKey: 'sk-test' } });
  assert.equal(c.status, 200, c.text);
  agents = (await owner.get('/api/agents')).json.agents;
  for (const a of agents) {
    await owner.post('/api/agents/update', { id: a.id, connectionId: c.json.id, nativeId: 'mind' });
    await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' });
    await owner.post('/api/agent-work', { agent: a.id, defaultMode: 'life' });
  }
  ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: owner.cookie } });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
});
after(async () => { try { ws?.close(); } catch { /* closed */ } await s?.stop(); fake?.close(); });

async function say(agent, session, input, extra = {}, who = owner) {
  const r = await who.post('/api/providers/runs', { agent, session, input, ...extra });
  assert.equal(r.status, 200, r.text);
  const end = await waitFor(async () => { const e = (await who.get('/api/providers/runs/events?run=' + encodeURIComponent(r.json.runId))).json; return e && e.done ? e.events.map(x => x.event).find(x => x.type === 'run.end') : null; });
  assert.ok(end, 'it answered');
  return end;
}
const newChat = async (a, who = owner) => (await who.post('/api/chat-sessions/create', { agent: a.id })).json.session;
/** The note the brain got with its newest message, from the call made after seen[n]. */
const noteAfter = n => { const call = seen.slice(n).find(j => j.stream); return textOf(call.messages.at(-1).content); };

test('a group: the one who speaks later is told what the person and the other said', async () => {
  const [A, B] = agents;
  const sa = await newChat(A), sb = await newChat(B);
  const group = [A.id, B.id];
  const first = await say(A.id, sa.id, 'What does everyone think?', { group, groupSay: true });
  assert.equal(first.status, 'ok');
  const n = seen.length;
  const second = await say(B.id, sb.id, 'What did they say?', { group });
  assert.equal(second.status, 'ok');
  const text = noteAfter(n);
  assert.match(text, /Hello, both of you\./, "the other agent's answer is in the thread");
  assert.match(text, new RegExp(A.name + ': '), 'named by who said it');
  assert.match(text, /Owner: What does everyone think\?/, "and the person's own line, by their name");
  assert.match(text, /group conversation with Owner, Test Agent 1/i, 'told it is a group, and who is in it');
});

test('one agent alone is not a group: nothing of a thread goes with its message', async () => {
  const [A] = agents;
  const sa = await newChat(A);
  const n = seen.length;
  await say(A.id, sa.id, 'Just us.', { group: [A.id], groupSay: true });
  assert.doesNotMatch(noteAfter(n), /group conversation/i);
});

test('one thread, in order: its own answers are "You", between the others\' and the person\'s lines', async () => {
  const [A, , C] = agents;
  const sa = await newChat(A), sc = await newChat(C), group = [C.id, A.id, A.id];   // (any order, a repeat counts once)
  await say(A.id, sa.id, 'say:t1', { group, groupSay: true });
  await say(C.id, sc.id, 'say:t1', { group });
  const n = seen.length;
  await say(A.id, sa.id, 'say:t2', { group, groupSay: true });
  const note = noteAfter(n);
  const order = ['Owner: say:t1', `You: ok:t1:${A.name}`, `${C.name}: ok:t1:${C.name}`, 'Owner: say:t2'].map(l => note.indexOf(l));
  assert.ok(order.every(k => k >= 0), note);
  assert.deepEqual([...order].sort((x, y) => x - y), order, 'in the order it was said: ' + note);
  assert.doesNotMatch(note, new RegExp(`${A.name}: ok:t1`), 'its own line as "You", not by its name');
});

test('the group goes with its message whatever its senses: on its phone (no senses) too', async () => {
  const [A, B] = agents;
  const sa = await newChat(A), sb = await newChat(B), group = [A.id, B.id];
  await say(A.id, sa.id, 'say:phone1', { group, groupSay: true, aware: false });
  const n = seen.length;
  await say(B.id, sb.id, 'say:phone1', { group, aware: false });
  const note = noteAfter(n);
  assert.match(note, /group conversation/);
  assert.match(note, new RegExp(`${A.name}: ok:phone1:${A.name}`));
  assert.doesNotMatch(note, /Around you:|together right now|Your body in the city/, 'and nothing of the city');
});

test('who may be in a group: agents the person may chat with, its own agent among them, at most 8', async () => {
  const [A, B, C] = agents;
  const sa = await newChat(A);
  const bad = async (body, who = owner) => { const r = await who.post('/api/providers/runs', { agent: body.agent ?? A.id, session: body.session ?? sa.id, input: 'hi', group: body.group }); return r; };
  for (const group of [[A.id, 999999], [B.id, C.id], [A.id, 'x'], [A.id, -3], [A.id, 1.5], 'A,B', Array.from({ length: 9 }, (_, k) => A.id + k)]) {
    const r = await bad({ group });
    assert.equal(r.status, 400, JSON.stringify(group) + ' ' + r.text);
    assert.equal(r.json.code, 'bad_group', JSON.stringify(group));
  }
  assert.doesNotMatch((await bad({ group: [A.id, 999999] })).json.message || '', /999999|not found|exist/i, 'says nothing about whose an agent is');
  // (Ann may chat with B, not with A: A can't be in her group, and nothing of it is kept)
  const annId = (await ann.get('/api/auth/me')).json.account.id;
  assert.equal((await owner.post('/api/agents/share', { id: B.id, kind: 'account', who: String(annId), level: 'use' })).status, 200);
  const sb = await newChat(B, ann);
  const r = await bad({ agent: B.id, session: sb.id, group: [B.id, A.id] }, ann);
  assert.equal(r.status, 400); assert.equal(r.json.code, 'bad_group');
  assert.equal((await ann.get(`/api/providers/history?agent=${B.id}&session=${sb.id}`)).json.messages?.length ?? 0, 0, 'the refused message is not kept');
  // (a group of 8 is fine; the same ids in another order are the same group)
  const ok = await owner.post('/api/providers/runs', { agent: A.id, session: (await newChat(A)).id, input: 'hi', group: [C.id, B.id, A.id, B.id] });
  assert.equal(ok.status, 200, ok.text);
});

test('the next one, started the moment the one before is done, already hears its answer', async () => {
  const [A, B, C] = agents;
  const ses = { [A.id]: (await newChat(A)).id, [B.id]: (await newChat(B)).id, [C.id]: (await newChat(C)).id };
  const group = [A.id, B.id, C.id], order = [A.id, B.id, C.id], runs = new Map(), notes = [];
  // (as the voice dock does: each member's run the instant the page hears the one before ended — its run.end frame)
  for (let turn = 0; turn < 4; turn++) {
    const token = `race${turn}`;
    await new Promise((resolve, reject) => {
      let k = 0;
      const start = async () => {
        const agent = order[k];
        const n = seen.length;
        const r = await owner.post('/api/providers/runs', { agent, session: ses[agent], input: `say:${token}`, group, groupSay: k === 0 });
        if (r.status !== 200) { reject(new Error(r.text)); return; }
        runs.set(r.json.runId, { agent, n });
      };
      const on = ev => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t !== 'chat' || m.event?.type !== 'run.end' || !runs.has(m.run)) return;
        const done = runs.get(m.run); runs.delete(m.run);
        notes.push({ agent: done.agent, n: done.n, token });
        if (++k < order.length) start().catch(reject); else { ws.removeEventListener('message', on); resolve(); }
      };
      ws.addEventListener('message', on);
      start().catch(reject);
    });
  }
  // every member after the first heard all who spoke before it in that turn
  for (const x of notes) {
    const note = noteAfter(x.n), k = order.indexOf(x.agent);
    for (const before of order.slice(0, k)) {
      const name = agents.find(a => a.id === before).name;
      assert.match(note, new RegExp(`${name}: ok:${x.token}:${name}`), `${x.agent} in ${x.token} heard ${name}: ${note}`);
    }
  }
});
