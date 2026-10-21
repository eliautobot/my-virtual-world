// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The chat with an OpenClaw agent on a real server (docs/features/agent-providers.md §4–§5), against the stand-in gateway
// replaying runs recorded from OpenClaw 2026.9.6 (tests/helpers/fake-openclaw.mjs): a new chat makes a session on the
// gateway and follows it; an answer streams with what it is doing and its reasoning; a command waits for approval with
// the provider's choices and runs as a step; Stop aborts on the gateway; the history is the provider's; the models and
// each one's thinking levels, set in the session at once (a level the model hasn't is refused by the gateway); the
// context meter; the gateway's own sessions for whoever manages the provider, and only theirs for anyone else; files go
// as the gateway takes them, within the limits it announces.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';
import { startFakeOpenClaw } from './helpers/fake-openclaw.mjs';

let s, owner, ann, gw, agent;
const sleep = ms => new Promise(r => setTimeout(r, ms));
before(async () => {
  gw = await startFakeOpenClaw({ token: 'gw-chat-token', agents: [{ id: 'tester', name: 'Tester' }] });
  s = await startServer({ population: 150 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  const c = await owner.post('/api/connections', { kind: 'openclaw', label: 'Gateway', scope: 'installation', config: { url: gw.url }, secrets: { token: gw.token } });
  for (let i = 0; i < 100; i++) {
    const p = (await owner.get('/api/agent-providers')).json.providers.find(x => x.id === c.json.id);
    if (p && p.status && p.status.state === 'connected' && p.agents.length) { agent = p.agents[0].id; break; }
    await sleep(100);
  }
  assert.ok(agent, 'the provider connected with its agent');
});
after(async () => { await s?.stop(); await gw?.stop(); });

/** Sends `input` in chat `session` and follows the run to its end: { id, events, partial }. onEvent may act on one. */
async function run(c, session, input, { onEvent = null, attachments } = {}) {
  const r = await c.post('/api/providers/runs', { agent, session, input, ...(attachments ? { attachments } : {}) });
  assert.equal(r.status, 200, r.text);
  const id = r.json.runId, events = [];
  let since = 0, done = false;
  for (let i = 0; i < 300 && !done; i++) {
    await sleep(40);
    const e = (await c.get(`/api/providers/runs/events?run=${id}&since=${since}`)).json;
    for (const x of e.events || []) { events.push(x.event); since = x.seq; if (onEvent) await onEvent(x.event, id); }
    done = e.done;
  }
  assert.ok(done, `the run ended (${events.map(e => e.type).join(', ')})`);
  return { id, events, session: r.json.session };
}
const newChat = async (c = owner) => (await c.post('/api/chat-sessions/create', { agent, label: 'New chat' })).json.session;

test('the chat says what an OpenClaw agent can do (and that its history is the provider\'s)', async () => {
  const can = (await owner.get(`/api/chat/can?agent=${agent}`)).json;
  assert.equal(can.ok, true); assert.equal(can.kind, 'openclaw');
  for (const k of ['tools', 'context', 'approvals', 'models', 'effort', 'attachments', 'stop', 'agents']) assert.equal(can.caps[k], true, k);
  assert.equal(can.caps.rewrite, false, 'no editing or writing again');
  const a = (await owner.get('/api/agents')).json.agents.find(x => x.id === agent);
  assert.deepEqual(a.provider, { kind: 'openclaw', label: 'OpenClaw', connection: 'Gateway' });
});

test('a new chat makes a session on the gateway, follows it, and streams the answer with its reasoning', async () => {
  const chat = await newChat();
  const r = await run(owner, chat.id, 'Think it through [[think]]');
  const key = r.session.key;
  assert.match(key, /^agent:tester:dashboard:/, 'the gateway\'s own session');
  assert.ok(gw.sends.some(x => x.sessionKey === key && x.idempotencyKey === r.id), 'chat.send with this run as its idempotency key');
  assert.ok(r.events.some(e => e.type === 'run.status'), 'what it is doing first');
  const end = r.events.find(e => e.type === 'run.end');
  assert.equal(end.status, 'ok'); assert.match(end.thinking, /step by step/); assert.equal(end.model, 'stub/stub-2');
  // the history is the provider's, with the reasoning, and the context meter
  const h = (await owner.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).json;
  assert.deepEqual(h.messages.map(m => [m.role, m.source]), [['user', 'provider'], ['assistant', 'provider']]);
  assert.match(h.messages[1].meta.thinking, /step by step/);
  assert.deepEqual(h.usage, { used: 15000, size: 128000, fresh: true });
});

test('a command waits for approval with the provider\'s choices; allowed once, it runs as a step', async () => {
  const chat = await newChat();
  let asked = null;
  const r = await run(owner, chat.id, '[[tool:exec {"command":"echo approved-run && date +%Y"}]]', {
    onEvent: async (e, id) => {
      if (e.type !== 'approval.requested') return;
      asked = e;
      const bad = await owner.post('/api/providers/approvals', { run: id, approval: e.approvalId, decision: 'sometimes' });
      assert.equal(bad.status, 400, 'only the answers the step takes');
      const nope = await ann.post('/api/providers/approvals', { run: id, approval: e.approvalId, decision: 'allow-once' });
      assert.equal(nope.status, 404, 'nobody else answers it');
      assert.equal((await owner.post('/api/providers/approvals', { run: id, approval: e.approvalId, decision: 'allow-once' })).status, 200);
    },
  });
  assert.equal(asked.command, 'echo approved-run && date +%Y');
  assert.deepEqual(asked.options, ['allow-once', 'allow-always', 'deny']);
  assert.deepEqual(gw.resolutions.at(-1), { id: asked.approvalId, kind: 'exec', decision: 'allow-once' }, 'approval.resolve, as OpenClaw takes it');
  const resolved = r.events.find(e => e.type === 'approval.resolved');
  assert.equal(resolved.decision, 'allow-once');
  const end = r.events.find(e => e.type === 'tool.end');
  assert.equal(end.exitCode, 0); assert.match(end.text, /approved-run/);
  assert.equal(r.events.at(-1).status, 'ok');
  const h = (await owner.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).json;
  assert.equal(h.messages.find(m => m.meta && m.meta.steps).meta.steps[0].name, 'exec');
});

test('Stop aborts the run on the gateway', async () => {
  const chat = await newChat();
  const r = await run(owner, chat.id, 'Slowly [[slow]] [[think]]', { onEvent: async (e, id) => { if (e.type === 'run.status' && !gw.aborts.length) await owner.post('/api/providers/interrupt', { run: id }); } });
  assert.ok(gw.aborts.some(a => a.runId === r.id), 'chat.abort with the run');
  assert.equal(r.events.at(-1).status, 'stopped');
});

test('models with their thinking levels; a choice goes into the gateway\'s session at once; a level the model hasn\'t is refused', async () => {
  const m = (await owner.get(`/api/providers/models?agent=${agent}`)).json;
  assert.equal(m.default, 'stub/stub-1');
  assert.deepEqual(m.models.find(x => x.id === 'stub/stub-2').effort.map(x => x.id), ['off', 'minimal', 'low', 'medium', 'high']);
  const chat = await newChat();
  await run(owner, chat.id, 'hello');   // (the gateway's session exists from the first message)
  const key = (await owner.get(`/api/chat/recent?agent=${agent}`)).json.sessions.find(x => x.id === chat.id).key;
  const bad = await owner.post('/api/chat-sessions/prefs', { agent, session: chat.id, effort: 'high' });
  assert.equal(bad.status, 502, 'stub-1 has no "high": the gateway says so');
  assert.match(bad.json.error, /invalid thinkingLevel/);
  const ok = await owner.post('/api/chat-sessions/prefs', { agent, session: chat.id, model: 'stub/stub-2', effort: 'high' });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(gw.patches.at(-1), { key, model: 'stub/stub-2', thinkingLevel: 'high', label: undefined });
  assert.equal(gw.sessions.get(key).thinkingLevel, 'high');
  const h = (await owner.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).json;
  assert.deepEqual(h.session, { model: 'stub/stub-2', effort: 'high' });
  assert.equal(h.usage.size, 32000, 'the meter follows the model\'s window');
  // renaming the chat names the gateway's session too
  await owner.post('/api/chat-sessions/rename', { agent, session: chat.id, label: 'Planning' });
  assert.equal(gw.sessions.get(key).label, 'Planning');
});

test('whoever manages the provider sees its sessions made elsewhere; someone it is shared with sees only their own', async () => {
  // a session started outside this world (OpenClaw's Control UI, a channel)
  const key = gw.methods['sessions.create']({ agentId: 'tester' }).key;
  gw.sessions.get(key).label = 'From Telegram';
  await sleep(16000);   // (the provider's list is read again at most every 15 s per account and agent)
  const mine = (await owner.get(`/api/chat/recent?agent=${agent}`)).json.sessions;
  assert.ok(mine.some(x => x.key === key && x.label === 'From Telegram'), 'listed, with its name');
  // the agent shared with Ann to use: she sees no sessions but her own
  const annId = (await ann.get('/api/auth/me')).json.account.id;
  assert.equal((await owner.post('/api/agents/share', { id: agent, kind: 'account', who: String(annId), level: 'use' })).status, 200);
  const hers = (await ann.get(`/api/chat/recent?agent=${agent}`)).json.sessions;
  assert.equal(hers.length, 0);
  const own = (await ann.post('/api/chat-sessions/create', { agent, label: 'New chat' })).json.session;
  assert.equal((await ann.get(`/api/providers/history?agent=${agent}&session=${mine.find(x => x.key === key).id}`)).status, 404, 'not someone else\'s chat');
  assert.ok(own.id);
});

test('files go as the gateway takes them, and one beyond the limit it announced is refused before sending', async () => {
  const up = (name, buf) => owner.request('POST', `/api/chat/attachments?name=${encodeURIComponent(name)}`, buf, { 'content-type': 'application/octet-stream' });
  const f = (await up('notes.txt', Buffer.from('The secret word is BLUEBERRY.\n'))).json.attachment;
  const chat = await newChat();
  await run(owner, chat.id, 'Read it', { attachments: [f.id] });
  const sent = gw.sends.at(-1).attachments;
  assert.equal(sent.length, 1);
  assert.deepEqual({ type: sent[0].type, mimeType: sent[0].mimeType, fileName: sent[0].fileName }, { type: 'file', mimeType: 'text/plain', fileName: 'notes.txt' });
  assert.equal(Buffer.from(sent[0].content, 'base64').toString(), 'The secret word is BLUEBERRY.\n');
  // (the gateway announced an image limit of 6 MB: a bigger image is refused with the reason)
  const big = (await up('huge.png', Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(6.5 * 1048576)]))).json.attachment;
  if (big && /^image\//.test(big.mime)) {
    const r = await owner.post('/api/providers/runs', { agent, session: chat.id, input: 'and this', attachments: [big.id] });
    assert.ok(r.status >= 400); assert.match(r.json.error, /larger than this OpenClaw gateway takes/);
  }
});

test('a video goes to the agent as OpenClaw takes any file; its limits are said before uploading; it plays back from the chat', async () => {
  const up = (name, buf) => owner.request('POST', `/api/chat/attachments?name=${encodeURIComponent(name)}`, buf, { 'content-type': 'application/octet-stream' });
  const clip = Buffer.concat([Buffer.from('000000206674797069736f6d', 'hex'), Buffer.alloc(40000, 7)]);   // (an mp4's start, then bytes)
  const v = await up('holiday.mp4', clip);
  assert.equal(v.status, 200, v.text);
  assert.deepEqual([v.json.attachment.name, v.json.attachment.mime], ['holiday.mp4', 'video/mp4']);
  const chat = await newChat();
  await run(owner, chat.id, 'Watch this', { attachments: [v.json.attachment.id] });
  const sent = gw.sends.at(-1).attachments;
  assert.deepEqual({ type: sent[0].type, mimeType: sent[0].mimeType, fileName: sent[0].fileName, size: Buffer.from(sent[0].content, 'base64').length }, { type: 'file', mimeType: 'video/mp4', fileName: 'holiday.mp4', size: clip.length });
  // the limits the gateway announced, for the composer
  assert.deepEqual((await owner.get(`/api/providers/limits?agent=${agent}`)).json, { maxBytes: 19464192, maxImageBytes: 6291456 });
  // the person's own video plays back: inline, in byte ranges (a player seeks)
  const whole = await owner.get(`/api/chat/attachments/file?id=${v.json.attachment.id}`);
  assert.equal(whole.status, 200); assert.equal(whole.headers.get('content-type'), 'video/mp4'); assert.match(whole.headers.get('content-disposition'), /^inline/);
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  const part = await owner.request('GET', `/api/chat/attachments/file?id=${v.json.attachment.id}`, undefined, { range: 'bytes=0-11' });
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), `bytes 0-11/${clip.length}`);
  // a format that isn't a picture, document, text, video or recording is still refused
  const exe = await up('setup.exe', Buffer.from('MZ'));
  assert.equal(exe.status, 415); assert.match(exe.json.error, /video, audio/);
});

test('the agent asks: the question with its options; only the options it offers (or one\'s own words where it takes them) are an answer', async () => {
  const chat = await newChat();
  let asked = null;
  const r = await run(owner, chat.id, '[[ask]]', {
    onEvent: async (e, id) => {
      if (e.type !== 'question.requested') return;
      asked = e;
      assert.equal((await owner.post('/api/providers/questions', { run: id, question: e.questionId, answers: { colour: ['Blue', 'Red'] } })).status, 400, 'one answer only');
      assert.equal((await owner.post('/api/providers/questions', { run: id, question: e.questionId, answers: { nope: ['Blue'] } })).status, 400, 'its own questions only');
      assert.equal((await ann.post('/api/providers/questions', { run: id, question: e.questionId, answers: { colour: ['Blue'] } })).status, 404, 'nobody else answers it');
      assert.equal((await owner.post('/api/providers/questions', { run: id, question: e.questionId, answers: { colour: ['Teal, please'] } })).status, 200, 'its own words: it takes a free answer');
    },
  });
  assert.equal(asked.questions[0].question, 'Which colour do you like?');
  assert.deepEqual(gw.resolutions.at(-1).answers, { answers: { colour: ['Teal, please'] } }, 'question.resolve as OpenClaw takes it');
  const done = r.events.find(e => e.type === 'question.resolved');
  assert.equal(done.status, 'answered');
  assert.equal(r.events.some(e => /^tool\./.test(e.type)), false, 'the question is its card, not a step');
});

test('the plan: its steps as the run goes, and the session\'s progress card in the history', async () => {
  const chat = await newChat();
  const r = await run(owner, chat.id, '[[plan]]');
  const p = r.events.find(e => e.type === 'plan.update');
  assert.deepEqual(p.steps.map(x => x.status), ['completed', 'in_progress', 'pending']);
  const h = (await owner.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).json;
  assert.equal(h.plan.markdown, 'Reviewing the docs');
  assert.equal(h.plan.steps.length, 3);
});

test('the progress card: Refresh asks the agent to bring it up to date; the new card reaches whoever has the chat open', async () => {
  const chat = await newChat();
  await run(owner, chat.id, '[[plan]]');
  const h = (await owner.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).json;
  assert.deepEqual(h.planCan, { refresh: true, dismiss: true }, 'the gateway offers Refresh and Dismiss');
  assert.equal(h.plan.revision, 1);
  const key = (await owner.get(`/api/chat/recent?agent=${agent}`)).json.sessions.find(x => x.id === chat.id).key;
  assert.equal((await owner.post('/api/providers/watch', { agent, session: chat.id })).json.ok, true);
  const ws = new (await import('ws')).default(s.url.replace('http', 'ws') + '/ws', { headers: { cookie: owner.cookie, origin: s.url } });
  const cards = [];
  ws.on('message', d => { try { const m = JSON.parse(String(d)); if (m.t === 'chat' && m.card) cards.push(m); } catch { /* not JSON */ } });
  await new Promise(r => ws.once('open', r));
  await sleep(200);
  const r = await owner.post('/api/providers/progress/refresh', { agent, session: chat.id, key: 'f2b0c4de-77aa-4c55-9e1b-0d3a5b6c7e8f' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json, { accepted: true, revision: 1 });
  const asked = gw.refreshes.at(-1);
  assert.equal(asked.sessionKey, key); assert.equal(asked.agentId, 'tester');
  assert.equal(asked.idempotencyKey, 'f2b0c4de-77aa-4c55-9e1b-0d3a5b6c7e8f', 'the page\'s key: a retry is the same request');
  assert.equal((await owner.post('/api/providers/progress/refresh', { agent, session: chat.id, key: 'no spaces allowed' })).status, 400);
  for (let i = 0; i < 100 && !cards.length; i++) await sleep(30);
  ws.close();
  assert.equal(cards.length, 1, 'the new card, once');
  assert.equal(cards[0].session, chat.id); assert.equal(cards[0].agent, agent);
  assert.deepEqual(cards[0].card.steps.map(x => x.status), ['completed', 'completed', 'completed']);
  assert.equal(cards[0].card.markdown, 'Checked again');
  assert.equal(cards[0].card.revision, 2, 'newer than the one refreshed');
  assert.ok(cards[0].card.updatedAt > 0);
  // the history has it too
  assert.equal((await owner.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).json.plan.markdown, 'Checked again');
  // a chat without a card: the gateway's own reason; a chat not yet begun: none to refresh; someone else's chat: not found
  const bare = await newChat();
  await run(owner, bare.id, 'hello');
  const none = await owner.post('/api/providers/progress/refresh', { agent, session: bare.id });
  assert.ok(none.status >= 400, none.text); assert.match(none.json.error.message || none.json.message || none.text, /no progress card/i);
  assert.equal((await owner.post('/api/providers/progress/refresh', { agent, session: (await newChat()).id })).status, 400);
  assert.equal((await ann.post('/api/providers/progress/refresh', { agent, session: chat.id })).status, 404);
  assert.equal(gw.refreshes.length, 1, 'only the one request reached the gateway');
  await owner.post('/api/providers/watch', { agent, session: chat.id, on: false });
});

test('the progress card: Dismiss takes off the version the person saw; one written since stays', async () => {
  const chat = await newChat();
  await run(owner, chat.id, '[[plan]]');
  // the agent wrote again (a refresh) after the page last showed it: dismissing the old version keeps the new one
  await owner.post('/api/providers/progress/refresh', { agent, session: chat.id });
  for (let i = 0; i < 50 && (await owner.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).json.plan.revision !== 2; i++) await sleep(30);
  const stale = await owner.post('/api/providers/progress/dismiss', { agent, session: chat.id, revision: 1 });
  assert.equal(stale.status, 200, stale.text);
  assert.equal(stale.json.dismissed, false); assert.equal(stale.json.plan.revision, 2, 'the newer card, to show');
  assert.equal((await owner.post('/api/providers/progress/dismiss', { agent, session: chat.id })).status, 400, 'which version');
  assert.equal((await ann.post('/api/providers/progress/dismiss', { agent, session: chat.id, revision: 2 })).status, 404);
  const ok = await owner.post('/api/providers/progress/dismiss', { agent, session: chat.id, revision: 2 });
  assert.deepEqual(ok.json, { dismissed: true });
  assert.equal((await owner.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).json.plan, undefined, 'gone from the chat');
});

test('background tasks: the chat\'s subagents and jobs for whoever manages the provider — running and finished, one task\'s prompt, result and transcript, Stop, live changes', async () => {
  const chat = await newChat();
  await run(owner, chat.id, 'hello');
  const key = (await owner.get(`/api/chat/recent?agent=${agent}`)).json.sessions.find(x => x.id === chat.id).key;
  const can = (await owner.get(`/api/chat/can?agent=${agent}`)).json;
  assert.equal(can.caps.tasks, true); assert.equal(can.manage, true);
  // two tasks from this chat (one running, one done) and one from another session (not this chat's)
  const running = gw.task(key, { title: 'Research the venues', progressSummary: 'Read 3 of 5 sites', toolUseCount: 4, lastToolName: 'web_fetch',
    execution: { state: 'running', currentTool: { name: 'web_fetch', startedAt: Date.now() - 2000 }, lastActivityAt: Date.now() }, prompt: 'Find three venues', transcript: [
      { role: 'user', content: [{ type: 'text', text: 'Find three venues' }], timestamp: Date.now() - 5000 },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'web_fetch', arguments: { url: 'https://example.com' } }, { type: 'text', text: 'Looking at the first site.' }], timestamp: Date.now() - 4000 }] });
  const done = gw.task(key, { title: 'Summarise the notes', status: 'completed', runtime: 'cron', endedAt: Date.now() - 1000, terminalSummary: 'Done: 2 pages', result: 'The notes say: book early.', terminalOutcome: 'succeeded', deliveryStatus: 'delivered' });
  const other = gw.task('agent:tester:main', { title: 'Not this chat' });
  const list = await owner.get(`/api/providers/tasks?agent=${agent}&session=${chat.id}`);
  assert.equal(list.status, 200, list.text);
  assert.deepEqual(list.json.active.map(t => t.id), [running]);
  assert.deepEqual(list.json.recent.map(t => t.id), [done]);
  const r = list.json.active[0];
  assert.equal(r.title, 'Research the venues'); assert.equal(r.status, 'running'); assert.equal(r.runtime, 'subagent');
  assert.equal(r.execution.tool.name, 'web_fetch'); assert.equal(r.progressSummary, 'Read 3 of 5 sites'); assert.equal(r.toolUseCount, 4);
  assert.equal(r.prompt, undefined, 'the list carries no prompt or result');
  for (const k of ['sessionKey', 'ownerKey', 'childSessionKey', 'agentId']) assert.equal(r[k], undefined, `never the gateway's ${k}`);
  // one task: its prompt and result; its transcript
  const one = (await owner.get(`/api/providers/tasks/one?agent=${agent}&session=${chat.id}&task=${done}`)).json.task;
  assert.equal(one.result, 'The notes say: book early.'); assert.equal(one.terminalOutcome, 'succeeded');
  const tr = (await owner.get(`/api/providers/tasks/history?agent=${agent}&session=${chat.id}&task=${running}`)).json;
  assert.deepEqual(tr.messages.map(m => m.role), ['user', 'assistant']);
  assert.equal(tr.messages[1].text, 'Looking at the first site.'); assert.equal(tr.messages[1].steps.length, 1);
  // another chat's task is not this chat's to read or stop
  assert.equal((await owner.get(`/api/providers/tasks/one?agent=${agent}&session=${chat.id}&task=${other}`)).status, 404);
  assert.equal((await owner.post('/api/providers/tasks/cancel', { agent, session: chat.id, task: other })).status, 404);
  assert.equal(gw.cancels.length, 0);
  // someone the provider is only shared with: not theirs to see (Ann's own chat, even)
  const annChat = await newChat(ann);
  assert.equal((await ann.get(`/api/providers/tasks?agent=${agent}&session=${annChat.id}`)).status, 403);
  assert.equal((await ann.get(`/api/providers/tasks?agent=${agent}&session=${chat.id}`)).status, 404);
  // live: with the chat open (watched), a change reaches the page; Stop cancels on the gateway and the end comes too
  assert.equal((await owner.post('/api/providers/watch', { agent, session: chat.id })).json.ok, true);
  const ws = new (await import('ws')).default(s.url.replace('http', 'ws') + '/ws', { headers: { cookie: owner.cookie, origin: s.url } });
  const frames = [];
  ws.on('message', d => { try { const m = JSON.parse(String(d)); if (m.t === 'chat' && m.task) frames.push(m); } catch { /* not JSON */ } });
  await new Promise(res => ws.once('open', res));
  await sleep(200);
  for (let i = 0; i < 5; i++) gw.task(key, { id: running, progressSummary: `Read ${i + 3} of 5 sites` });   // (a burst: reported once)
  gw.task('agent:tester:main', { id: other, progressSummary: 'elsewhere' });
  for (let i = 0; i < 60 && !frames.length; i++) await sleep(30);
  await sleep(600);
  const ours = frames.filter(m => m.task.here !== false);
  assert.ok(frames.filter(m => m.task.here === false).every(m => m.task.task.id === other), 'the agent\'s work elsewhere comes too — marked not this chat\'s');
  assert.equal(ours.length, 1, 'a burst of changes, once');
  assert.equal(ours[0].session, chat.id); assert.equal(ours[0].task.change, 'upserted'); assert.equal(ours[0].task.task.progressSummary, 'Read 7 of 5 sites');
  const stop = await owner.post('/api/providers/tasks/cancel', { agent, session: chat.id, task: running });
  assert.equal(stop.status, 200, stop.text);
  assert.equal(stop.json.cancelled, true); assert.equal(stop.json.task.status, 'cancelled');
  assert.equal(gw.cancels.at(-1).taskId, running);
  for (let i = 0; i < 60 && !frames.some(m => m.task.task?.status === 'cancelled'); i++) await sleep(30);
  assert.ok(frames.some(m => m.task.task?.status === 'cancelled'), 'the end, at once');
  ws.close();
  assert.equal((await ann.post('/api/providers/tasks/cancel', { agent, session: annChat.id, task: done })).status, 403);
  await owner.post('/api/providers/watch', { agent, session: chat.id, on: false });
});

test('the agents\' browser: its tabs, the page live (frames), and the person\'s clicks, keys, typing and scrolling — for whoever manages the provider', async () => {
  const base = `/api/providers/browser`;
  // not running: said so; started, a tab opened (the gateway's own rules: no local address)
  let st = (await owner.get(`${base}?agent=${agent}`)).json;
  assert.deepEqual([st.available, st.running, st.tabs.length], [true, false, 0]);
  assert.equal((await owner.post(base, { agent, action: 'start' })).json.ok, true);
  const local = await owner.post(base, { agent, action: 'open', url: 'http://127.0.0.1/admin' });
  assert.equal(local.status, 400, 'the gateway\'s rules refuse it: the request\'s fault, not the gateway\'s'); assert.match(local.json.error, /navigation rules block/);
  assert.equal((await owner.post(base, { agent, action: 'open', url: 'javascript:alert(1)' })).status, 400, 'only web addresses');
  const opened = await owner.post(base, { agent, action: 'open', url: 'example.com' });
  assert.equal(opened.status, 200, opened.text);
  const tab = opened.json.tab.id;
  assert.equal(opened.json.tab.url, 'https://example.com/', 'an address without its scheme is https');
  st = (await owner.get(`${base}?agent=${agent}`)).json;
  assert.deepEqual(st.tabs.map(t => [t.id, t.title]), [[tab, 'Example Domain']]);
  // the live picture: the first frame, then the next only when the page changes (a long wait answers "no change")
  const frame = await owner.get(`${base}/frame?agent=${agent}&tab=${tab}&after=0`);
  assert.equal(frame.status, 200, frame.text);
  assert.equal(frame.headers.get('content-type'), 'image/jpeg');
  assert.equal(frame.headers.get('x-page-width'), '1000'); assert.equal(decodeURIComponent(frame.headers.get('x-page-url')), 'https://example.com/');
  const seq = Number(frame.headers.get('x-frame-seq'));
  assert.ok(seq > 0);
  const next = owner.get(`${base}/frame?agent=${agent}&tab=${tab}&after=${seq}`);
  await sleep(150);
  gw.browserFrame(tab, { cssWidth: 800 });
  const n = await next;
  assert.equal(n.status, 200); assert.equal(n.headers.get('x-page-width'), '800'); assert.ok(Number(n.headers.get('x-frame-seq')) > seq);
  // a click where the person clicked on the picture (fractions of it), in the page's own size; keys by name; text typed
  assert.equal((await owner.post(base, { agent, action: 'click', tab, fx: 0.5, fy: 0.25 })).status, 200);
  assert.deepEqual(gw.browser.acts.at(-1), { kind: 'clickCoords', targetId: tab, x: 400, y: 150 });
  assert.equal((await owner.post(base, { agent, action: 'key', tab, key: 'Enter' })).status, 200);
  assert.deepEqual(gw.browser.acts.at(-1), { kind: 'press', targetId: tab, key: 'Enter' });
  assert.equal((await owner.post(base, { agent, action: 'key', tab, key: 'F12' })).status, 400, 'only the keys a page takes');
  assert.equal((await owner.post(base, { agent, action: 'text', tab, text: 'hello world' })).status, 200);
  assert.deepEqual(gw.browser.acts.at(-1), { kind: 'insertText', targetId: tab, text: 'hello world' });
  // scrolling and history: fixed functions with numbers in them, never a script of anyone's choosing
  assert.equal((await owner.post(base, { agent, action: 'scroll', tab, dx: 0, dy: '120); fetch("x"' })).status, 400);
  assert.equal((await owner.post(base, { agent, action: 'scroll', tab, dx: 0, dy: 360 })).status, 200);
  assert.equal(gw.browser.acts.at(-1).fn, '() => { window.scrollBy(0, 360); return true; }');
  assert.equal((await owner.post(base, { agent, action: 'back', tab })).status, 200);
  assert.equal(gw.browser.acts.at(-1).fn, '() => { history.go(-1); return true; }');
  assert.equal((await owner.post(base, { agent, action: 'evaluate', tab, fn: '() => document.cookie' })).status, 400);
  assert.equal((await owner.post(base, { agent, action: 'navigate', tab, url: 'https://example.org/' })).json.url, 'https://example.org/');
  // someone the agent is only shared with (to chat): not theirs
  const annId = (await ann.get('/api/auth/me')).json.account.id;
  assert.equal((await owner.post('/api/agents/share', { id: agent, kind: 'account', who: String(annId), level: 'use' })).status, 200);
  assert.equal((await ann.get(`${base}?agent=${agent}`)).status, 403);
  assert.equal((await ann.get(`${base}/frame?agent=${agent}&tab=${tab}`)).status, 403);
  assert.equal((await ann.post(base, { agent, action: 'click', tab, fx: 0.1, fy: 0.1 })).status, 403);
  assert.equal((await owner.post(base, { agent, action: 'close', tab })).json.ok, true);
  assert.equal((await owner.get(`${base}?agent=${agent}`)).json.tabs.length, 0);
  assert.equal((await owner.post(base, { agent, action: 'focus', tab })).status, 404, 'a closed tab: gone');
});

test('all of the agent\'s tasks (scope=agent): its scheduled jobs (no chat) and work from other chats too, marked as such; live with the chat open', async () => {
  const chat = await newChat();
  await run(owner, chat.id, 'hello');
  const key = (await owner.get(`/api/chat/recent?agent=${agent}`)).json.sessions.find(x => x.id === chat.id).key;
  // (as on a real gateway: a scheduled job's run belongs to no session; a CLI run to the agent's main session)
  const job = gw.task(null, { title: 'Notify Aster when Hermes route returns', runtime: 'cron', status: 'completed', agentId: 'tester', sessionKey: undefined, ownerKey: '', childSessionKey: undefined, endedAt: Date.now() - 500 });
  const cli = gw.task('agent:tester:main', { title: 'python3 -u -', runtime: 'cli', status: 'running' });
  const mine = gw.task(key, { title: 'Draft the reply', status: 'running' });
  const otherAgent = gw.task('agent:someone-else:main', { title: 'Not this agent', agentId: 'someone-else' });
  // this chat: only its own
  const here = (await owner.get(`/api/providers/tasks?agent=${agent}&session=${chat.id}`)).json;
  assert.deepEqual(here.active.map(t => t.id), [mine]);
  // all of the agent's: its job, its CLI run, this chat's — marked; never another agent's
  const all = await owner.get(`/api/providers/tasks?agent=${agent}&session=${chat.id}&scope=agent`);
  assert.equal(all.status, 200, all.text);
  const ids = [...all.json.active, ...all.json.recent].map(t => t.id);
  for (const id of [job, cli, mine]) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes(otherAgent), 'not another agent\'s');
  assert.equal(all.json.active.find(t => t.id === mine).here, true);
  assert.equal(all.json.active.find(t => t.id === cli).here, false);
  assert.equal(all.json.recent.find(t => t.id === job).title, 'Notify Aster when Hermes route returns');
  // no chat needed for all of them (a chat just begun); a chat's tasks need one
  assert.equal((await owner.get(`/api/providers/tasks?agent=${agent}&scope=agent`)).status, 200);
  assert.equal((await owner.get(`/api/providers/tasks?agent=${agent}`)).status, 400);
  // one of them, and Stop, through the same scope; not through this chat's
  assert.equal((await owner.get(`/api/providers/tasks/one?agent=${agent}&session=${chat.id}&task=${cli}&scope=agent`)).status, 200);
  assert.equal((await owner.get(`/api/providers/tasks/one?agent=${agent}&session=${chat.id}&task=${cli}`)).status, 404);
  assert.equal((await owner.get(`/api/providers/tasks/one?agent=${agent}&scope=agent&task=${otherAgent}`)).status, 404);
  // live: with this chat open, a change in the agent's other work comes too — marked not here
  assert.equal((await owner.post('/api/providers/watch', { agent, session: chat.id })).json.ok, true);
  const ws = new (await import('ws')).default(s.url.replace('http', 'ws') + '/ws', { headers: { cookie: owner.cookie, origin: s.url } });
  const frames = [];
  ws.on('message', d => { try { const m = JSON.parse(String(d)); if (m.t === 'chat' && m.task && m.session === chat.id) frames.push(m.task); } catch { /* not JSON */ } });
  await new Promise(res => ws.once('open', res));
  await sleep(200);
  gw.task('agent:tester:main', { id: cli, status: 'completed', endedAt: Date.now() });
  gw.task(key, { id: mine, status: 'completed', endedAt: Date.now() });
  gw.task('agent:someone-else:main', { id: otherAgent, status: 'completed', agentId: 'someone-else', endedAt: Date.now() });
  for (let i = 0; i < 60 && frames.length < 2; i++) await sleep(30);
  await sleep(300);
  ws.close();
  assert.deepEqual(frames.map(f => [f.task.id, f.here]).sort(), [[cli, false], [mine, true]].sort(), 'its own work and the chat\'s, not another agent\'s');
  const stop = await owner.post('/api/providers/tasks/cancel', { agent, session: chat.id, task: gw.task('agent:tester:main', { title: 'A long run', runtime: 'cli' }), scope: 'agent' });
  assert.equal(stop.status, 200, stop.text); assert.equal(stop.json.cancelled, true);
  await owner.post('/api/providers/watch', { agent, session: chat.id, on: false });
});

test('which chats are working: an answer being written here, or the provider running a turn there from anywhere — in the list and live', async () => {
  const chat = await newChat();
  await run(owner, chat.id, 'hello');
  const key = (await owner.get(`/api/chat/recent?agent=${agent}`)).json.sessions.find(x => x.id === chat.id).key;
  const listed = async () => (await owner.get(`/api/chat/recent?agent=${agent}`)).json.sessions.find(x => x.id === chat.id);
  assert.equal((await listed()).working, undefined, 'at rest');
  const ws = new (await import('ws')).default(s.url.replace('http', 'ws') + '/ws', { headers: { cookie: owner.cookie, origin: s.url } });
  const marks = [];
  ws.on('message', d => { try { const m = JSON.parse(String(d)); if (m.t === 'chat' && m.working !== undefined && m.session === chat.id) marks.push(m.working); } catch { /* not JSON */ } });
  await new Promise(res => ws.once('open', res));
  await sleep(200);
  // a turn on another channel (nobody here following it): the gateway's session feed says the session runs one
  gw.external(key, 'thinking', 'From the phone', 250);   // (slow enough to be seen on a busy machine)
  let w = null;
  for (let i = 0; i < 100 && !(w = await listed()).working; i++) await sleep(50);
  assert.equal(w.working, true, 'listed as working');
  for (let i = 0; i < 200 && (await listed()).working; i++) await sleep(50);
  assert.equal((await listed()).working, undefined, 'and not, once the turn is over');
  ws.close();
  assert.deepEqual([marks[0], marks.at(-1)], [true, false], 'the page was told as it happened');
});

test('slash commands for the / menu (the ones a person can type)', async () => {
  const c = (await owner.get(`/api/providers/commands?agent=${agent}`)).json;
  assert.deepEqual(c.commands.map(x => x.alias), ['/help', '/status']);
});

test('live activity: a run on another channel in a watched session reaches whoever watches it, marked observed', async () => {
  const chat = await newChat();
  await run(owner, chat.id, 'hello');
  const key = (await owner.get(`/api/chat/recent?agent=${agent}`)).json.sessions.find(x => x.id === chat.id).key;
  assert.equal((await owner.post('/api/providers/watch', { agent, session: chat.id })).json.ok, true);
  // the frames the owner's page gets, over the live socket
  const ws = new (await import('ws')).default(s.url.replace('http', 'ws') + '/ws', { headers: { cookie: owner.cookie, origin: s.url } });
  const frames = [];
  ws.on('message', d => { try { const m = JSON.parse(String(d)); if (m.t === 'chat' && m.observed) frames.push(m); } catch { /* not JSON */ } });
  await new Promise(r => ws.once('open', r));
  await sleep(300);
  const ext = gw.external(key);
  for (let i = 0; i < 100 && !frames.some(m => m.event && m.event.type === 'run.end'); i++) await sleep(50);
  ws.close();
  assert.ok(frames.length > 2, 'frames came');
  assert.ok(frames.every(m => m.run === ext && m.session === chat.id), 'its own run id, in the open chat');
  assert.match(frames.filter(m => m.delta && m.delta.text).map(m => m.delta.text).join(''), /Stub reply/);
  assert.equal(frames.at(-1).event.type, 'run.end');
  // Ann (no manage) cannot watch it
  assert.equal((await ann.post('/api/providers/watch', { agent, session: chat.id })).status, 404);
  assert.equal((await owner.post('/api/providers/watch', { agent, session: chat.id, on: false })).json.ok, true);
});

test('questions in a watched session from a run that isn\'t ours: shown to whoever watches it, answered by them; those asked before the page opened come when it does', async () => {
  const chat = await newChat();
  await run(owner, chat.id, 'hello');
  const key = (await owner.get(`/api/chat/recent?agent=${agent}`)).json.sessions.find(x => x.id === chat.id).key;
  const ws = new (await import('ws')).default(s.url.replace('http', 'ws') + '/ws', { headers: { cookie: owner.cookie, origin: s.url } });
  const frames = [];
  ws.on('message', d => { try { const m = JSON.parse(String(d)); if (m.t === 'chat' && m.observed) frames.push(m); } catch { /* not JSON */ } });
  await new Promise(r => ws.once('open', r));
  const asked = async () => { for (let i = 0; i < 100; i++) { const f = frames.find(m => m.event && m.event.type === 'question.requested'); if (f) return f; await sleep(50); } return null; };
  const ended = async ext => { for (let i = 0; i < 100; i++) { if (frames.some(m => m.run === ext && m.event && m.event.type === 'run.end')) return true; await sleep(50); } return false; };
  try {
    // 1. the page has the session open; another channel's run asks
    assert.equal((await owner.post('/api/providers/watch', { agent, session: chat.id })).json.ok, true);
    await sleep(300);
    const ext = gw.external(key, 'question');
    const q = await asked();
    assert.ok(q, 'the question reaches the page');
    assert.equal(q.run, ext); assert.equal(q.session, chat.id);
    assert.deepEqual(q.event.questions.map(x => x.question), ['Which colour do you like?']);
    assert.equal((await ann.post('/api/providers/questions', { run: ext, question: q.event.questionId, answers: { colour: ['Blue'] } })).status, 404, 'nobody else answers it');
    assert.equal((await owner.post('/api/providers/questions', { run: ext, question: q.event.questionId, answers: { colour: ['Blue', 'Red'] } })).status, 400, 'checked as for its own runs: one answer only');
    const ok = await owner.post('/api/providers/questions', { run: ext, question: q.event.questionId, answers: { colour: ['Blue'] } });
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(gw.resolutions.at(-1).answers, { answers: { colour: ['Blue'] } }, 'question.resolve as OpenClaw takes it');
    assert.ok(await ended(ext), 'the run goes on to its end');
    assert.equal((await owner.post('/api/providers/watch', { agent, session: chat.id, on: false })).json.ok, true);
    // 2. it asks with nobody watching; the page that opens the session afterwards gets it (question.list)
    frames.length = 0;
    const ext2 = gw.external(key, 'question');
    await sleep(400);
    assert.equal(frames.length, 0, 'nothing while nobody watches');
    assert.equal((await owner.post('/api/providers/watch', { agent, session: chat.id })).json.ok, true);
    const q2 = await asked();
    assert.ok(q2, 'the waiting question comes when the page opens');
    assert.equal(q2.run, ext2);
    assert.equal((await owner.post('/api/providers/questions', { run: ext2, question: q2.event.questionId, answers: { colour: ['Red'] } })).status, 200);
    assert.deepEqual(gw.resolutions.at(-1).answers, { answers: { colour: ['Red'] } });
    assert.ok(await ended(ext2), 'that run goes on to its end too');
  } finally {
    ws.close();
    await owner.post('/api/providers/watch', { agent, session: chat.id, on: false });
  }
});

test('an answer\'s media: what the agent attached, at addresses signed for its chat, served only to who may read it', async () => {
  const chat = await newChat();
  const r = await run(owner, chat.id, 'Show me [[media]]');
  // the run's end carries them (from the history: OpenClaw keeps an answer's media there, not in the live answer)
  const end = r.events.find(e => e.type === 'run.end');
  assert.deepEqual((end.media || []).map(m => m.kind).sort(), ['image', 'video']);
  const h = (await owner.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).json;
  const ans = h.messages.filter(m => m.role === 'assistant').at(-1);
  assert.equal(/MEDIA:/.test(ans.text), false, 'the MEDIA line leaves the text');
  const img = ans.meta.media.find(m => m.kind === 'image'), vid = ans.meta.media.find(m => m.kind === 'video');
  assert.deepEqual([img.name, img.mime, img.w, img.h], ['chart.png', 'image/png', 1, 1]);
  assert.equal(vid.name, 'clip.mp4');
  for (const m of ans.meta.media) { assert.match(m.src, /^\/api\/providers\/media\?agent=\d+&session=\d+&r=[\w-]+&s=[\w-]+$/); assert.equal('ref' in m, false, 'the provider\'s reference stays on the server'); }
  assert.equal(JSON.stringify(h).includes('/work/clip.mp4') || JSON.stringify(h).includes('artifact_managed'), false);
  // the kept image: through artifacts.download and its ticketed link
  const got = await fetch(`${s.url}${img.src}`, { headers: { cookie: owner.cookie } });
  assert.equal(got.status, 200); assert.equal(got.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), (await import('./helpers/fake-openclaw.mjs')).MEDIA_PNG);
  assert.match(got.headers.get('content-security-policy') || '', /sandbox/);
  // the path the agent wrote: through assistant-media with this device's token; a byte range for a video seeking
  const part = await fetch(`${s.url}${vid.src}`, { headers: { cookie: owner.cookie, range: 'bytes=0-8' } });
  assert.equal(part.status, 206); assert.equal(Buffer.from(await part.arrayBuffer()).toString(), 'FAKE-MP4-');
  assert.match(part.headers.get('content-range'), /^bytes 0-8\/\d+$/);
  // fetched once, then from the cache
  const hits = gw.webHits.filter(x => x.includes('assistant-media')).length;
  assert.equal((await fetch(`${s.url}${vid.src}`, { headers: { cookie: owner.cookie } })).status, 200);
  assert.equal(gw.webHits.filter(x => x.includes('assistant-media')).length, hits, 'served from the cache');
  // only at an address this server signed, and only to who may read that chat
  assert.equal((await fetch(`${s.url}${img.src.replace(/s=[\w-]+$/, 's=AAAA')}`, { headers: { cookie: owner.cookie } })).status, 404, 'a changed signature');
  const other = new URL(img.src, s.url); other.searchParams.set('r', Buffer.from(JSON.stringify({ source: '/etc/passwd' })).toString('base64url'));
  assert.equal((await fetch(`${s.url}${other.pathname}${other.search}`, { headers: { cookie: owner.cookie } })).status, 404, 'a file the page names itself');
  assert.equal((await fetch(`${s.url}${img.src}`, { headers: { cookie: ann.cookie } })).status, 404, 'someone who may not read that chat');
  // a file OpenClaw won't send for that session: said so (the page shows a card)
  gw.files.delete('/work/clip.mp4');
  const chat2 = await newChat();
  await run(owner, chat2.id, 'Again [[media]]');
  const ans2 = (await owner.get(`/api/providers/history?agent=${agent}&session=${chat2.id}`)).json.messages.filter(m => m.role === 'assistant').at(-1);
  const gone = await fetch(`${s.url}${ans2.meta.media.find(m => m.kind === 'video').src}`, { headers: { cookie: owner.cookie } });
  assert.equal(gone.status, 502); assert.match((await gone.json()).error, /no such file/);
  gw.files.set('/work/clip.mp4', { mime: 'video/mp4', bytes: Buffer.from('FAKE-MP4-'.repeat(200)) });
});

test('a message sent while the agent works: OpenClaw takes it into the running turn by default (no answer of its own), or after it with later', async () => {
  const follow = async (c, id) => {
    const events = [];
    let since = 0, done = false;
    for (let i = 0; i < 400 && !done; i++) {
      await sleep(40);
      const e = (await c.get(`/api/providers/runs/events?run=${id}&since=${since}`)).json;
      for (const x of e.events || []) { events.push(x.event); since = x.seq; }
      done = e.done;
    }
    assert.ok(done, 'the run ended');
    return events;
  };
  const chat = await newChat();
  const a = await owner.post('/api/providers/runs', { agent, session: chat.id, input: 'Take your time [[slow:700]]' });
  assert.equal(a.status, 200, a.text);
  await sleep(150);
  // Enter while it works: sent at once, with the gateway's own setting (no queue mode of ours) — steered into the turn
  const b = await owner.post('/api/providers/runs', { agent, session: chat.id, input: 'And one more thing' });
  assert.equal(b.status, 200, b.text);
  assert.equal(gw.sends.find(x => x.idempotencyKey === b.json.runId).queueMode, undefined);
  const endB = (await follow(owner, b.json.runId)).find(e => e.type === 'run.end');
  assert.deepEqual([endB.status, endB.steered], ['ok', true], 'its own run ends empty: the running turn answers it');
  await follow(owner, a.json.runId);
  const h = (await owner.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).json.messages;
  assert.ok(h.some(m => m.role === 'user' && m.text === 'And one more thing'), 'the message is in the conversation');
  assert.ok(h.some(m => m.role === 'assistant' && /Steered in: And one more thing/.test(m.text)), 'answered in the running turn');
  assert.equal(h.some(m => m.role === 'system' && /without sending an answer/.test(m.text)), false);
  // Ctrl+Enter: after this answer — the gateway runs it next, with an answer of its own
  const c = await owner.post('/api/providers/runs', { agent, session: chat.id, input: 'Again, slowly [[slow:700]]' });
  await sleep(150);
  const d = await owner.post('/api/providers/runs', { agent, session: chat.id, input: 'After you', queue: 'later' });
  assert.equal(d.status, 200, d.text);
  assert.equal(gw.sends.find(x => x.idempotencyKey === d.json.runId).queueMode, 'followup');
  const evD = await follow(owner, d.json.runId), endD = evD.find(e => e.type === 'run.end');
  assert.equal(endD.status, 'ok'); assert.ok(endD.text, 'its own answer'); assert.equal(endD.steered, undefined);
  await follow(owner, c.json.runId);
  assert.equal((await owner.post('/api/providers/runs', { agent, session: chat.id, input: 'x', queue: 'soon' })).status, 400, 'later or nothing');
});

test('a page opened while an answer is being written learns of it from the history (and follows it)', async () => {
  const chat = await newChat();
  const a = await owner.post('/api/providers/runs', { agent, session: chat.id, input: 'Take your time [[slow:400]]' });
  assert.equal(a.status, 200, a.text);
  const h = (await owner.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).json;
  assert.equal(h.live, a.json.runId, 'the answer still being written');
  assert.equal((await ann.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).status, 404, 'only its own person reads that chat');
  for (let i = 0; i < 300 && !(await owner.get(`/api/providers/runs/events?run=${a.json.runId}&since=0`)).json.done; i++) await sleep(50);
  assert.equal((await owner.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).json.live, undefined, 'none once it is done');
});

test('live presence: an agent at work on another of its channels (no page following it) works in the city too, then goes back', async () => {
  const state = async () => (await owner.get(`/api/presence/${agent}`)).json;
  for (let i = 0; i < 100 && (await state()).state !== 'idle'; i++) await sleep(100);
  assert.equal((await state()).state, 'idle');
  gw.external('agent:tester:telegram-chat', 'thinking', 'From Telegram', 400);   // (a session nobody here follows)
  let st = null;
  for (let i = 0; i < 100 && !(st = await state()).working; i++) await sleep(50);
  assert.equal(st.working, true, 'working while OpenClaw says one of its turns runs');
  assert.equal(st.source, 'provider');
  for (let i = 0; i < 200 && (st = await state()).state === 'working'; i++) await sleep(50);
  assert.ok(['finishing', 'idle'].includes(st.state), `then it finishes (${st.state})`);
});
