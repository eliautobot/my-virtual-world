// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Hermes as an agent provider on a real server (docs/features/agent-providers.md §9), against the stand-in Hermes backend
// replaying turns recorded from Hermes 0.21.5 (tests/helpers/fake-hermes.mjs): it connects with the session token, or
// signs in with a username and password and forgets the password; its profiles become agents; the universal chat — a
// streamed answer with its reasoning, a command as a step, Hermes' approval with its four choices, its questions, Stop, a
// message sent while it works (steered into the turn, or after it), the model and thinking level for that chat only,
// files, an answer's media — the history from Hermes' stored messages; its sessions for whoever manages it; its sub-menu
// for managers only, a fixed list of calls, never a secret's value, a change against settings changed elsewhere refused.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';
import { startFakeHermes, FILE_PNG } from './helpers/fake-hermes.mjs';

let s, owner, ann, hm, conn, agent, research;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(c, id, state, { agents = 0, ms = 20000 } = {}) {
  const end = Date.now() + ms;
  let p = null;
  while (Date.now() < end) {
    p = (await c.get('/api/agent-providers')).json.providers.find(x => x.id === id);
    if (p && p.status && p.status.state === state && p.agents.length >= agents) return p;
    await sleep(120);
  }
  assert.fail(`provider ${id} never reached ${state} (last: ${JSON.stringify(p && p.status)})`);
}
before(async () => {
  hm = await startFakeHermes({ token: 'hermes-SECRET-session-token' });
  s = await startServer({ population: 150 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  const c = await owner.post('/api/connections', { kind: 'hermes', label: 'Hermes', scope: 'installation', config: { url: hm.url, auth: 'token' }, secrets: { token: hm.token } });
  assert.equal(c.status, 200, c.text);
  conn = c.json.id;
  const p = await until(owner, conn, 'connected', { agents: 2 });
  agent = p.agents.find(a => a.nativeId === 'default').id;
  research = p.agents.find(a => a.nativeId === 'research');
});
after(async () => { await s?.stop(); await hm?.stop(); });

async function run(c, session, input, { onEvent = null, attachments, ag = agent } = {}) {
  const r = await c.post('/api/providers/runs', { agent: ag, session, input, ...(attachments ? { attachments } : {}) });
  assert.equal(r.status, 200, r.text);
  const id = r.json.runId, events = [];
  let since = 0, done = false;
  for (let i = 0; i < 400 && !done; i++) {
    await sleep(40);
    const e = (await c.get(`/api/providers/runs/events?run=${id}&since=${since}`)).json;
    for (const x of e.events || []) { events.push(x.event); since = x.seq; if (onEvent) await onEvent(x.event, id); }
    done = e.done;
  }
  assert.ok(done, `the run ended (${events.map(e => e.type).join(', ')})`);
  return { id, events, session: r.json.session };
}
const newChat = async (c = owner, ag = agent) => (await c.post('/api/chat-sessions/create', { agent: ag, label: 'New chat' })).json.session;

test('it connects with the session token; its profiles are agents, named as Hermes shows them; the chat says what they can do', async () => {
  const p = (await owner.get('/api/agent-providers')).json.providers.find(x => x.id === conn);
  assert.equal(p.status.version, '0.21.5');
  assert.deepEqual(p.agents.map(a => a.name).sort(), ['Researcher', 'default']);
  assert.equal(JSON.stringify(p).includes('SECRET'), false, 'the session token never reaches a page');
  const can = (await owner.get(`/api/chat/can?agent=${agent}`)).json;
  assert.equal(can.ok, true); assert.equal(can.kind, 'hermes');
  for (const k of ['tools', 'context', 'approvals', 'questions', 'models', 'effort', 'attachments', 'files', 'stop', 'queue', 'commands', 'plan', 'tasks', 'native']) assert.equal(can.caps[k], true, k);
  assert.equal(can.caps.browser, undefined, 'no shared browser');
  const a = (await owner.get('/api/agents')).json.agents.find(x => x.id === agent);
  assert.equal(a.provider.kind, 'hermes');
});

test('a wrong session token says so, with how Hermes takes one', async () => {
  const c = await owner.post('/api/connections', { kind: 'hermes', label: 'Wrong', scope: 'installation', config: { url: hm.url, auth: 'token' }, secrets: { token: 'not-it' } });
  const p = await until(owner, c.json.id, 'error');
  assert.equal(p.status.code, 'auth_rejected');
  assert.match(p.status.fix, /HERMES_DASHBOARD_SESSION_TOKEN/);
  await owner.post('/api/connections/remove', { id: c.json.id });
});

test('a new chat makes a Hermes session tagged as this installation\'s and streams the answer with its reasoning', async () => {
  const chat = await newChat();
  const r = await run(owner, chat.id, 'Think it through [[think]]');
  const key = r.session.key;
  assert.match(key, /^20261017_/);
  assert.equal(hm.sessions.get(key).source, 'myvirtualworld');
  assert.equal(hm.sessions.get(key).profile, 'default');
  const end = r.events.at(-1);
  assert.equal(end.type, 'run.end'); assert.equal(end.status, 'ok');
  assert.match(end.text, /Stub reply/); assert.equal(end.thinking, 'Let me think about this step by step.');
  const h = (await owner.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).json;
  assert.deepEqual(h.messages.map(m => m.role), ['user', 'assistant']);
  assert.equal(h.messages[1].meta.thinking, 'Let me think about this step by step.');
  assert.deepEqual(h.usage, { used: 1200, size: 256000 });
});

test('a command waits for Hermes\' approval with its four choices; denied, the step says it did not run', async () => {
  const chat = await newChat();
  let asked = null;
  const r = await run(owner, chat.id, '[[tool:terminal {"command":"rm -rf /tmp/x"}]]', { onEvent: async (e, id) => {
    if (e.type !== 'approval.requested') return;
    asked = e;
    assert.deepEqual(e.options, ['allow-once', 'allow-session', 'allow-always', 'deny']);
    assert.equal((await ann.post('/api/providers/approvals', { run: id, approval: e.approvalId, decision: 'allow-once' })).status, 404, 'nobody else answers it');
    assert.equal((await owner.post('/api/providers/approvals', { run: id, approval: e.approvalId, decision: 'deny' })).status, 200);
  } });
  assert.ok(asked, 'it asked');
  assert.equal(asked.command, 'rm -rf /tmp/lab');
  assert.deepEqual(hm.lastAnswer, { choice: 'deny' }, 'Hermes got the decision as the answer to its own request');
  const end = r.events.find(e => e.type === 'tool.end');
  assert.equal(end.ok, false); assert.equal(end.status, 'blocked');
  assert.ok(r.events.some(e => e.type === 'approval.resolved' && e.decision === 'deny'));
});

test('"allow in this chat" goes to Hermes as its session choice', async () => {
  const chat = await newChat();
  await run(owner, chat.id, '[[tool:terminal {"command":"rm -rf /tmp/y"}]]', { onEvent: async (e, id) => {
    if (e.type === 'approval.requested') assert.equal((await owner.post('/api/providers/approvals', { run: id, approval: e.approvalId, decision: 'allow-session' })).status, 200);
  } });
  assert.deepEqual(hm.lastAnswer, { choice: 'session' });
});

test('the agent\'s questions: answered by Hermes\' question ids, a free answer taken; only its starter answers', async () => {
  const chat = await newChat();
  let q = null;
  await run(owner, chat.id, '[[tool:clarify {"questions":[{"question":"Which colour?","choices":["Red","Blue"]},{"question":"Anything else?"}]}]]', { onEvent: async (e, id) => {
    if (e.type !== 'question.requested') return;
    q = e;
    assert.equal((await ann.post('/api/providers/questions', { run: id, question: e.questionId, answers: { q0: ['Blue'] } })).status, 404);
    assert.equal((await owner.post('/api/providers/questions', { run: id, question: e.questionId, answers: { q0: ['Blue'], q1: ['Nothing more'] } })).status, 200);
  } });
  assert.equal(q.questions.length, 2);
  assert.deepEqual(hm.lastAnswer, { answers: { q0: 'Blue', q1: 'Nothing more' } });
});

test('Stop interrupts the turn on Hermes', async () => {
  const chat = await newChat();
  const r = await run(owner, chat.id, 'Slowly [[slow]] [[think]]', { onEvent: async (e, id) => { if (e.type === 'run.delta' || e.type === 'run.status') await owner.post('/api/providers/interrupt', { run: id }); } });
  assert.equal(r.events.at(-1).status, 'stopped');
});

test('a message sent while it works: steered into the running turn (its own run ends empty), or answered after it', async () => {
  const chat = await newChat();
  const first = await owner.post('/api/providers/runs', { agent, session: chat.id, input: 'A long one [[slow]] [[think]]' });
  assert.equal(first.status, 200, first.text);
  await sleep(150);
  const steer = await owner.post('/api/providers/runs', { agent, session: chat.id, input: 'also mention cats' });
  assert.equal(steer.status, 200, steer.text);
  const later = await owner.post('/api/providers/runs', { agent, session: chat.id, input: 'then this', queue: 'later' });
  assert.equal(later.status, 200, later.text);
  const later2 = await owner.post('/api/providers/runs', { agent, session: chat.id, input: 'and this too', queue: 'later' });
  assert.equal(later2.status, 200, later2.text);
  const end = async id => { for (let i = 0; i < 300; i++) { const e = (await owner.get(`/api/providers/runs/events?run=${id}&since=0`)).json; if (e.done) return e.events.map(x => x.event).at(-1); await sleep(40); } return null; };
  const st = await end(steer.json.runId);
  assert.equal(st.steered, true, 'taken into the turn');
  const a = await end(first.json.runId);
  assert.match(a.text, /also mention cats/, 'the running turn answered it');
  const b = await end(later.json.runId);
  assert.equal(b.status, 'ok'); assert.match(b.text, /Stub answer to: then this/);
  const c2 = await end(later2.json.runId);
  assert.equal(c2.steered, true, 'Hermes merged it into the waiting turn: no answer of its own');
  assert.match(b.text, /and this too/, 'that one turn answers both');
});

test('the socket to Hermes lost mid-answer: it reconnects by itself, takes up the session again, and the answer arrives', async () => {
  const chat = await newChat();
  let dropped = false;
  const r = await run(owner, chat.id, 'Through a drop [[slow]] [[think]]', { onEvent: async e => { if (!dropped && e.type === 'run.status') { dropped = true; hm.dropSockets(); } } });
  assert.ok(dropped);
  const end = r.events.at(-1);
  assert.equal(end.status, 'ok', JSON.stringify(end));
  assert.match(end.text, /Stub reply/);
});

test('a message while it works with Enter, as Hermes Desktop sends it: Hermes\' redirect — the turn goes on with it; its own run ends at once', async () => {
  const chat = await newChat();
  const first = await owner.post('/api/providers/runs', { agent, session: chat.id, input: 'A long one [[slow]] [[think]]' });
  assert.equal(first.status, 200, first.text);
  await sleep(150);
  const red = await owner.post('/api/providers/runs', { agent, session: chat.id, input: 'make it about boats', queue: 'redirect' });
  assert.equal(red.status, 200, red.text);
  const end = async id => { for (let i = 0; i < 300; i++) { const e = (await owner.get(`/api/providers/runs/events?run=${id}&since=0`)).json; if (e.done) return e.events.map(x => x.event).at(-1); await sleep(40); } return null; };
  assert.equal((await end(red.json.runId)).steered, true, 'taken into the turn');
  assert.deepEqual(hm.redirects.slice(-1), ['make it about boats'], 'through session.redirect');
  assert.match((await end(first.json.runId)).text, /make it about boats/, 'the running turn went on with it');
  // (nothing running: a "redirect" is an ordinary message)
  const idle = await owner.post('/api/providers/runs', { agent, session: chat.id, input: 'now this', queue: 'redirect' });
  assert.equal(idle.status, 200, idle.text);
  assert.match((await end(idle.json.runId)).text, /Stub answer to: now this/);
});

test('the socket lost mid-answer: what was missed while it was down is fetched again from Hermes, in order, once — the answer whole', async () => {
  const chat = await newChat();
  const before = hm.replays || 0;
  const r = await owner.post('/api/providers/runs', { agent, session: chat.id, input: 'Through a drop again [[slow]] [[think]]' });
  assert.equal(r.status, 200, r.text);
  // the answer so far, as the page reads it, every 40 ms; the socket dropped once it has begun
  const partials = []; let dropped = false, end = null;
  for (let i = 0; i < 400 && !end; i++) {
    await sleep(40);
    const e = (await owner.get(`/api/providers/runs/events?run=${r.json.runId}&since=0`)).json;
    if (typeof e.partial === 'string' && e.partial) { partials.push(e.partial); if (!dropped && e.partial.length > 20) { dropped = true; hm.dropSockets(); } }
    if (e.done) end = e.events.map(x => x.event).at(-1);
  }
  assert.ok(dropped && end);
  assert.ok((hm.replays || 0) > before, 'session.events.since asked');
  assert.equal(end.status, 'ok', JSON.stringify(end));
  // what was written across the drop has no gap and nothing twice: each copy of it so far begins the final answer
  const norm = t => t.replace(/\s+/g, ' ').trim(), whole = norm(end.text);
  assert.ok(partials.length > 3);
  for (const x of partials) assert.ok(whole.startsWith(norm(x)), `a gap or a repeat: ${norm(x).slice(-80)}`);
});

test('a sudo password and a secret: what each is for comes in Hermes\' own stream (the command, the variable); the value goes to Hermes, never back', async () => {
  for (const [kind, words, field, want] of [['sudo', 'Install it [[sudo]]', 'command', 'apt-get update'], ['secret', 'Open the PR [[secret]]', 'env', 'GITHUB_TOKEN']]) {
    const chat = await newChat();
    let asked = null;
    const r = await run(owner, chat.id, words, { onEvent: async (e, id) => {
      if (e.type === 'native' && e.ev.op === 'ask') asked = e.ev;
      if (e.type === 'question.requested') { assert.equal(e.questions[0].secret, true); await owner.post('/api/providers/questions', { run: id, question: e.questionId, answers: { value: ['the-value'] } }); }
    } });
    assert.equal(asked && asked.kind, kind); assert.equal(asked[field], want);
    assert.equal(hm.masked.at(-1).value, 'the-value', `${kind}: Hermes has it`);
    assert.ok(!JSON.stringify(r.events).includes('the-value'), `${kind}: never in an event`);
  }
});

test('going back, as Hermes Desktop does: an edit of the first message replaces the chat (Hermes told so); a later one keeps what came before; a branch copies the chat up to an answer', async () => {
  const chat = await newChat();
  await run(owner, chat.id, 'one'); await run(owner, chat.id, 'two');
  let h = (await owner.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).json.messages;
  const users = h.filter(m => m.role === 'user');
  assert.ok(users.every(m => Number.isInteger(m.meta?.row)), 'each of the person\'s messages knows its row');
  assert.deepEqual(h.filter(m => m.role === 'assistant').map(m => m.meta.upto), [2, 4], 'each answer knows how far the record goes there');
  // the second message, edited: the first turn stays
  const r = await owner.post('/api/providers/runs', { agent, session: chat.id, input: 'two, edited', rewind: users[1].meta.row });
  assert.equal(r.status, 200, r.text);
  for (let i = 0; i < 100 && !(await owner.get(`/api/providers/runs/events?run=${r.json.runId}&since=0`)).json.done; i++) await sleep(40);
  h = (await owner.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).json.messages;
  assert.deepEqual(h.filter(m => m.role === 'user').map(m => m.text), ['one', 'two, edited']);
  // the first one: the whole chat goes (Hermes asks to be told — the adapter says so)
  const first = h.find(m => m.role === 'user').meta.row;
  const r2 = await owner.post('/api/providers/runs', { agent, session: chat.id, input: 'one again', rewind: first });
  assert.equal(r2.status, 200, r2.text);
  for (let i = 0; i < 100 && !(await owner.get(`/api/providers/runs/events?run=${r2.json.runId}&since=0`)).json.done; i++) await sleep(40);
  h = (await owner.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).json.messages;
  assert.deepEqual(h.filter(m => m.role === 'user').map(m => m.text), ['one again']);
  // a branch up to the first answer: a new chat of this person's, with that much
  await run(owner, chat.id, 'three');
  h = (await owner.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).json.messages;
  const b = await owner.post('/api/providers/branch', { agent, session: chat.id, upto: h.find(m => m.role === 'assistant').meta.upto });
  assert.equal(b.status, 200, b.text);
  assert.notEqual(b.json.session.id, chat.id);
  const bh = (await owner.get(`/api/providers/history?agent=${agent}&session=${b.json.session.id}`)).json.messages;
  assert.deepEqual(bh.map(m => m.role), ['user', 'assistant']);
  // (bad input refused)
  assert.equal((await owner.post('/api/providers/runs', { agent, session: chat.id, input: 'x', rewind: 'nope' })).status, 400);
  assert.equal((await owner.post('/api/providers/branch', { agent, session: chat.id, upto: 0 })).status, 400);
});

test('the chat menu, as Hermes Desktop\'s: the whole chat branched into a new one; archived on Hermes and gone from the list here', async () => {
  const chat = await newChat();
  await run(owner, chat.id, 'one'); await run(owner, chat.id, 'two');
  const b = await owner.post('/api/providers/branch', { agent, session: chat.id });
  assert.equal(b.status, 200, b.text);
  const bh = (await owner.get(`/api/providers/history?agent=${agent}&session=${b.json.session.id}`)).json.messages;
  assert.deepEqual(bh.filter(m => m.role === 'user').map(m => m.text), ['one', 'two'], 'the whole chat');
  const key = (await owner.get(`/api/chat-sessions?agent=${agent}`)).json.sessions.find(x => x.id === chat.id).key;
  const a = await owner.post('/api/providers/archive', { agent, session: chat.id });
  assert.equal(a.status, 200, a.text);
  assert.equal(hm.sessions.get(key).archived, true, 'Hermes keeps it, archived');
  assert.ok(!(await owner.get(`/api/chat-sessions?agent=${agent}`)).json.sessions.some(x => x.id === chat.id), 'out of the list here');
});

test('a chat waiting for the person says so in the list (an approval asked), then works on, then not', async () => {
  const chat = await newChat();
  const states = [];
  const r = await run(owner, chat.id, 'rm -rf /tmp/never-here', { onEvent: async (e, id) => {
    if (e.type === 'approval.requested') {
      await sleep(80);
      // (the window's own list: /api/chat/recent says which chats work)
      states.push((await owner.get(`/api/chat/recent?agent=${agent}`)).json.sessions.find(x => x.id === chat.id)?.working);
      await owner.post('/api/providers/approvals', { run: id, approval: e.approvalId, decision: 'deny' });
      await sleep(80);
      states.push((await owner.get(`/api/chat/recent?agent=${agent}`)).json.sessions.find(x => x.id === chat.id)?.working);
    }
  } });
  assert.equal(r.events.at(-1).type, 'run.end');
  assert.equal(states[0], 'waiting');
  assert.ok(states[1] === true || states[1] === undefined, `then working or done: ${states[1]}`);
});

test('slash commands as Hermes Desktop runs them: Hermes\' own calls only, on the chat\'s own session (a new chat\'s made first and named after the command), answers rebuilt; a skill\'s words shown as its command', async () => {
  const nat = (who, session, method, params, extra = {}) => who.post('/api/providers/native', { agent, session, method, params, ...extra });
  // (a new chat: /status makes its session on Hermes, which is this chat's from then on — named after the command)
  const chat = await newChat();
  const st = await nat(owner, chat.id, 'session.status', {}, { preview: '/status' });
  assert.equal(st.status, 200, st.text);
  assert.match(st.json.result.output, /^Hermes TUI Status/);
  assert.notEqual(st.json.session.key, '@new', 'the chat has its Hermes session now');
  assert.equal(st.json.session.label, '/status', 'named after the command until Hermes names it');
  const key = st.json.session.key;
  assert.ok(hm.sessions.get(key), 'made on Hermes'); assert.equal(hm.sessions.get(key).source, 'myvirtualworld');
  // (the session it acts on is the chat's — never one the page names)
  const sv = await nat(owner, chat.id, 'session.save', { session_id: 'someone-elses' });
  assert.equal(sv.status, 200); assert.equal(sv.json.result.file, `/h/sessions/saved/${key}.json`); assert.equal(sv.json.result.secret, undefined, 'rebuilt: nothing beyond its fields');
  // (only Hermes' listed calls, with their arguments)
  assert.equal((await nat(owner, chat.id, 'session.delete', {})).status, 400);
  assert.equal((await nat(owner, chat.id, 'config.set', { key: 'model', value: 'x' })).status, 400, 'only /reasoning and /yolo settings');
  assert.equal((await nat(owner, chat.id, 'config.set', { key: 'yolo', value: '1', scope: 'global' })).status, 400, '/yolo is this chat\'s only');
  // /yolo toggles this chat's; /reasoning sets its thinking
  assert.equal((await nat(owner, chat.id, 'config.set', { key: 'yolo', value: 'toggle' })).json.result.value, '1');
  assert.equal((await nat(owner, chat.id, 'config.set', { key: 'yolo', value: 'toggle' })).json.result.value, '0');
  assert.equal((await nat(owner, chat.id, 'config.set', { key: 'reasoning', value: 'high' })).json.result.value, 'high');
  assert.equal((await nat(owner, chat.id, 'config.get', { key: 'reasoning' })).json.result.value, 'high');
  // the catalog and suggestions, rebuilt (Hermes' extras dropped)
  const cat = (await nat(owner, chat.id, 'commands.catalog', {})).json.result;
  assert.equal(cat.commands['/config'].desktop, 'terminal'); assert.equal(cat.canon['/reset'], '/new'); assert.equal(cat.skills, undefined); assert.equal(cat.token, undefined);
  const cs = (await nat(owner, chat.id, 'complete.slash', { text: '/st' })).json.result;
  assert.deepEqual(cs.items.map(x => x.display), ['/status']); assert.equal(cs.extra, undefined);
  const cp = (await nat(owner, chat.id, 'complete.path', { word: '@file:' })).json.result;
  assert.deepEqual(cp.items.map(x => x.text), ['@file:notes.md', '@file:pic.png']);
  assert.equal(hm.pathQueries.at(-1).session, [...hm.live.values()].find(l => l.key === key).sid, 'the chat\'s folder');
  // (suggestions for a chat not begun on Hermes yet: the agent's, no session made)
  const fresh = await newChat();
  assert.equal((await nat(owner, fresh.id, 'complete.slash', { text: '/n' })).status, 200);
  assert.equal((await owner.get(`/api/chat-sessions?agent=${agent}`)).json.sessions.find(x => x.id === fresh.id).key, '@new');
  // /title renames it on Hermes, and here
  const t = await nat(owner, chat.id, 'session.title', { title: 'Weather plans' });
  assert.equal(t.json.result.title, 'Weather plans'); assert.equal(t.json.session.label, 'Weather plans'); assert.equal(hm.sessions.get(key).title, 'Weather plans');
  // Hermes' own commands: slash.exec; a skill through command.dispatch (Hermes' refusal says why)
  assert.match((await nat(owner, chat.id, 'slash.exec', { command: 'usage' })).json.result.output, /Token Usage/);
  const bad = await nat(owner, chat.id, 'command.dispatch', { name: 'nonexistent', arg: '' });
  assert.equal(bad.status, 502); assert.match(bad.json.error, /not a quick\/plugin\/bundle\/skill command/);
  const sk = (await nat(owner, chat.id, 'command.dispatch', { name: 'airtable', arg: 'check the weather' })).json.result;
  assert.equal(sk.type, 'skill'); assert.equal(sk.display, '/airtable check the weather'); assert.match(sk.message, /^\[IMPORTANT: The user has invoked the "airtable" skill/);
  // (sent as the person's message: Hermes keeps the skill's words; the history shows the command, as its Desktop does)
  await run(owner, chat.id, sk.message);
  const h = (await owner.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).json.messages;
  const u = h.filter(m => m.role === 'user').at(-1);
  assert.equal(u.text, '/airtable check the weather'); assert.equal(u.meta.skill, true); assert.ok(Number.isInteger(u.meta.row), 'still a row to go back to');
  // /compress: the transcript Hermes keeps now, its context use the meter's
  await run(owner, chat.id, 'one more'); await run(owner, chat.id, 'and another');
  const cpz = (await nat(owner, chat.id, 'session.compress', {})).json.result;
  assert.match(cpz.summary.headline, /^Compressed/); assert.ok(cpz.removed > 0); assert.equal(cpz.messages, undefined, 'the transcript is read again, not carried');
  assert.deepEqual((await owner.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).json.usage, { used: 900, size: 256000 });
});

test('the session\'s goal, loop and heartbeat, as Hermes Desktop shows them: read, followed live, changed by Hermes\' own actions; a resumed goal\'s continuation to send', async () => {
  const nat = (session, method, params) => owner.post('/api/providers/native', { agent, session, method, params });
  const fresh = await newChat();
  assert.deepEqual((await nat(fresh.id, 'session.control.read', {})).json.result, { control: null }, 'a chat not begun on Hermes has none (nothing asked)');
  assert.equal((await owner.get(`/api/chat-sessions?agent=${agent}`)).json.sessions.find(x => x.id === fresh.id).key, '@new');
  const chat = await newChat();
  await run(owner, chat.id, 'hello');
  const ws = new (await import('ws')).default(s.url.replace('http', 'ws') + '/ws', { headers: { cookie: owner.cookie, origin: s.url } });
  const frames = [];
  ws.on('message', d => { try { const m = JSON.parse(String(d)); if (m.t === 'chat' && m.side && m.side.op === 'control') frames.push(m); } catch { /* not JSON */ } });
  await new Promise(res => ws.once('open', res));
  assert.equal((await owner.post('/api/providers/watch', { agent, session: chat.id })).json.ok, true);
  assert.deepEqual((await nat(chat.id, 'session.control.read', {})).json.result.control.goal, null);
  const g = (await nat(chat.id, 'slash.exec', { command: 'goal Write a haiku about boats' })).json.result;
  assert.equal(g.type, 'send'); assert.match(g.notice, /Goal set/);
  for (let i = 0; i < 60 && !frames.length; i++) await sleep(30);
  assert.ok(frames.length, 'the change came live'); assert.equal(frames[0].session, chat.id);
  const live = frames[0].side.control;
  assert.equal(live.goal.title, 'Write a haiku about boats'); assert.equal(live.goal.max_turns, 20); assert.equal(live.secret, undefined, 'rebuilt: nothing beyond its fields');
  const read = (await nat(chat.id, 'session.control.read', {})).json.result.control;
  assert.equal(read.goal.status, 'active'); assert.deepEqual(read.goal.subgoals, []);
  const paused = (await nat(chat.id, 'session.control', { action: 'goal.pause' })).json.result;
  assert.equal(paused.control.goal.status, 'paused'); assert.equal(paused.dispatch.type, 'exec');
  assert.equal((await nat(chat.id, 'session.control', { action: 'subgoal.add', args: {} })).status, 400, 'a criterion needs its words');
  assert.equal((await nat(chat.id, 'session.control', { action: 'session.delete' })).status, 400, 'only Hermes\' own actions');
  assert.deepEqual((await nat(chat.id, 'session.control', { action: 'subgoal.add', args: { text: 'Mention the sea' } })).json.result.control.goal.subgoals, ['Mention the sea']);
  const resumed = (await nat(chat.id, 'session.control', { action: 'goal.resume' })).json.result;
  assert.equal(resumed.dispatch.type, 'send'); assert.match(resumed.dispatch.message, /^\[Continuing toward your standing goal\]/);
  const lp = (await nat(chat.id, 'slash.exec', { command: 'loop 30m check the news --times 3' })).json.result;
  assert.match(lp.output, /Loop set/);
  const both = (await nat(chat.id, 'session.control.read', {})).json.result.control;
  assert.equal(both.loop.times, 3); assert.equal(both.loop.deferred_by_goal, true);
  assert.equal((await nat(chat.id, 'session.control', { action: 'goal.clear' })).json.result.control.goal, null);
  assert.equal((await nat(chat.id, 'session.control', { action: 'loop.stop' })).json.result.control.loop, null);
  ws.close();
  assert.ok(frames.length >= 6, `every change came live (${frames.length})`);
});

test('/btw and /bg: the answer comes later, outside any turn, to whoever asked (and whoever has the chat open); commands only for whoever manages the provider', async () => {
  const chat = await newChat();
  await run(owner, chat.id, 'hello');
  const ws = new (await import('ws')).default(s.url.replace('http', 'ws') + '/ws', { headers: { cookie: owner.cookie, origin: s.url } });
  const frames = [];
  ws.on('message', d => { try { const m = JSON.parse(String(d)); if (m.t === 'chat' && m.side) frames.push(m); } catch { /* not JSON */ } });
  await new Promise(res => ws.once('open', res));
  const b = await owner.post('/api/providers/native', { agent, session: chat.id, method: 'prompt.btw', params: { text: 'What did I say?' } });
  assert.equal(b.status, 200, b.text); assert.match(b.json.result.task_id, /^btw_/);
  const g = await owner.post('/api/providers/native', { agent, session: chat.id, method: 'prompt.background', params: { text: 'Say hi' } });
  assert.match(g.json.result.task_id, /^bg_/);
  for (let i = 0; i < 80 && frames.length < 2; i++) await sleep(30);
  // (Hermes' self-improvement review after a turn: to whoever's turn it was, its 💾 left to the line's own glyph)
  await run(owner, chat.id, 'Remember that I like short answers [[review]]');
  for (let i = 0; i < 80 && !frames.some(m => m.side.kind === 'review'); i++) await sleep(30);
  ws.close();
  const rv = frames.find(m => m.side.kind === 'review');
  assert.ok(rv, 'the review came'); assert.equal(rv.session, chat.id);
  assert.equal(rv.side.text, 'Self-improvement review: Memory updated · prefers short answers');
  const btw = frames.find(m => m.side.kind === 'btw'), bg = frames.find(m => m.side.kind === 'bg');
  assert.ok(btw && bg, `both answers came (${frames.length})`);
  assert.equal(btw.session, chat.id); assert.equal(btw.agent, agent);
  assert.deepEqual(btw.side, { op: 'side', kind: 'btw', id: b.json.result.task_id, question: 'What did I say?', text: 'Side answer to: What did I say?' });
  assert.equal(bg.side.id, g.json.result.task_id); assert.equal(bg.side.question, undefined);
  assert.equal((await owner.post('/api/providers/native', { agent, session: chat.id, method: 'prompt.btw', params: {} })).status, 400, 'a side question needs its words');
  // someone the agent is shared with (to use it): no commands — they change how it works, read its machine
  await owner.post('/api/agents/share', { id: agent, kind: 'account', who: String((await ann.get('/api/auth/me')).json.account.id), level: 'use' });
  const annChat = await newChat(ann);
  const no = await ann.post('/api/providers/native', { agent, session: annChat.id, method: 'session.status', params: {} });
  assert.equal(no.status, 403); assert.match(no.json.error, /manages/);
  assert.equal((await ann.post('/api/providers/native', { agent, session: chat.id, method: 'session.status', params: {} })).status, 404, 'not her chat');
  await owner.post('/api/agents/unshare', { id: agent, kind: 'account', who: String((await ann.get('/api/auth/me')).json.account.id) });
});

test('Reconnect while an answer is written: that answer ends with why, never left waiting; the chat goes on', async () => {
  const chat = await newChat();
  const r = await run(owner, chat.id, 'Long one [[slow]] [[think]]', { onEvent: async e => { if (e.type === 'run.status' && !hm.reconnected) { hm.reconnected = true; await owner.post('/api/agent-providers/reconnect', { id: conn }); } } });
  assert.equal(r.events.at(-1).status, 'interrupted');
  await until(owner, conn, 'connected');
  assert.equal((await run(owner, chat.id, 'and now?')).events.at(-1).status, 'ok');
});

test('the models of the agent\'s profile; a chat\'s model and thinking level go to Hermes for that chat only', async () => {
  const m = (await owner.get(`/api/providers/models?agent=${agent}`)).json;
  assert.equal(m.default, 'custom:stub-1');
  assert.deepEqual(m.models.map(x => x.id), ['custom:stub-1', 'custom:stub-2']);
  assert.ok(m.models[1].effort.some(x => x.id === 'none'), 'a model that may stop reasoning');
  const chat = await newChat();
  await run(owner, chat.id, 'first');
  assert.equal((await owner.post('/api/chat-sessions/prefs', { agent, session: chat.id, model: 'custom:stub-2', effort: 'high' })).status, 200);
  const sets = hm.configSets.slice(-2);
  assert.deepEqual(sets.map(x => [x.key, x.value]), [['model', 'stub-2 --provider custom --session'], ['reasoning', 'high']]);
  assert.equal((await owner.post('/api/chat-sessions/prefs', { agent, session: chat.id, effort: 'turbo' })).status, 502, 'a level Hermes doesn\'t have is refused by Hermes');
});

test('files: a picture queued for the turn, any other file staged with its reference in the message', async () => {
  const chat = await newChat();
  const up = async (name, buf) => (await owner.request('POST', `/api/chat/attachments?name=${encodeURIComponent(name)}`, buf, { 'content-type': 'application/octet-stream' })).json.attachment;
  const img = await up('dot.png', FILE_PNG), doc = await up('notes.txt', Buffer.from('hello notes'));
  assert.ok(img.id && doc.id, JSON.stringify([img, doc]));
  await run(owner, chat.id, 'look at these', { attachments: [img.id, doc.id] });
  assert.deepEqual(hm.attached.slice(-2).map(x => [x.kind, x.bytes]), [['image', FILE_PNG.length], ['file', 11]]);
  const key = (await owner.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).json.messages[0];
  assert.match(key.text, /@file:\/ws\/notes\.txt/);
});

test('an answer\'s media line: shown as a picture, fetched through Hermes\' file route', async () => {
  const chat = await newChat();
  const r = await run(owner, chat.id, 'draw it MEDIA:/tmp/chart.png');
  const h = (await owner.get(`/api/providers/history?agent=${agent}&session=${chat.id}`)).json;
  const ans = h.messages.at(-1);
  assert.equal(r.events.at(-1).type, 'run.end');
  assert.equal(ans.meta.media.length, 1); assert.equal(ans.meta.media[0].kind, 'image');
  assert.equal('ref' in ans.meta.media[0], false, 'Hermes\' path stays on the server');
  const res = await fetch(`${s.url}${ans.meta.media[0].src}`, { headers: { cookie: owner.cookie } });
  assert.equal(res.status, 200);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), FILE_PNG);
  assert.ok(hm.calls.includes('GET /api/files/download'));
});

test('its sessions from every channel for whoever manages it; anyone else only their own chats', async () => {
  const list = (await owner.get(`/api/chat-sessions?agent=${agent}`)).json.sessions;
  assert.ok(list.length >= 5);
  const can = await ann.get(`/api/chat/can?agent=${agent}`);
  assert.equal(can.json.ok, false, 'not shared with Ann');
});

test('the sub-menu: managers only, listed calls only, never a secret\'s value; a change against settings changed elsewhere refused', async () => {
  const call = (who, method, params) => who.post('/api/agent-providers/call', { id: conn, method, params });
  const st = await call(owner, 'status');
  assert.equal(st.status, 200); assert.equal(st.json.version, '0.21.5');
  const cfg = (await call(owner, 'config.get', { profile: 'default' })).json;
  assert.deepEqual(cfg.config.gateway.api_server.key, { secret: true, set: true });
  assert.equal(JSON.stringify(cfg).includes('super-secret-key'), false);
  assert.equal((await call(owner, 'env.reveal', {})).status, 400, 'not a listed call');
  assert.equal((await call(ann, 'status')).status, 404, 'not for a member who doesn\'t manage it');
  const ok = await call(owner, 'config.patch', { profile: 'default', changes: { 'display.busy_input_mode': 'queue' }, base: { 'display.busy_input_mode': 'steer' } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(hm.config.display.busy_input_mode, 'queue');
  const stale = await call(owner, 'config.patch', { profile: 'default', changes: { 'display.busy_input_mode': 'interrupt' }, base: { 'display.busy_input_mode': 'steer' } });
  assert.equal(stale.status, 400); assert.match(stale.json.error, /changed elsewhere/);
  assert.equal(hm.config.display.busy_input_mode, 'queue', 'nothing of the stale change applied');
  hm.config.display.busy_input_mode = 'steer';
  assert.equal((await call(owner, 'skills.set', { profile: 'default', name: 'web-research', enabled: false })).status, 200);
  assert.equal(hm.skills[0].enabled, false);
  assert.equal((await call(owner, 'cron.pause', { profile: 'default', id: 'j1' })).status, 200);
  assert.equal(hm.jobs[0].enabled, false);
  const audit = JSON.stringify((await owner.get('/api/audit?group=providers')).json);
  assert.match(audit, /config\.patch/); assert.match(audit, /skills\.set/);
  assert.equal(audit.includes('busy_input_mode'), false, 'which call, never what it carried');
});

test('signing in with a username and password: the password is used once and forgotten; the sign-in is renewed by itself', async () => {
  const h2 = await startFakeHermes({ mode: 'password', username: 'casey', password: 'pw-correct' });
  try {
    const bad = await owner.post('/api/connections', { kind: 'hermes', label: 'Signed', scope: 'installation', config: { url: h2.url, auth: 'password', username: 'casey' }, secrets: { password: 'wrong' } });
    let p = await until(owner, bad.json.id, 'error');
    assert.equal(p.status.code, 'bad_credentials');
    await owner.post('/api/connections/remove', { id: bad.json.id });
    h2.accessTtl = 2;   // (an access token that expires at once: the next socket renews it)
    const c = await owner.post('/api/connections', { kind: 'hermes', label: 'Signed', scope: 'installation', config: { url: h2.url, auth: 'password', username: 'casey' }, secrets: { password: 'pw-correct' } });
    p = await until(owner, c.json.id, 'connected', { agents: 2 });
    const view = (await owner.get('/api/connections')).json.connections.find(x => x.id === c.json.id);
    assert.equal(view.secrets.password, false, 'the password was used once, to sign in, and forgotten');
    h2.dropSockets();
    await sleep(300);
    p = await until(owner, c.json.id, 'connected');
    assert.ok(h2.refreshed >= 1, 'the access token was renewed with the refresh token');
    const chat = await newChat(owner, p.agents.find(a => a.nativeId === 'default').id);
    const r = await run(owner, chat.id, 'hi there', { ag: p.agents.find(a => a.nativeId === 'default').id });
    assert.equal(r.events.at(-1).status, 'ok');
    await owner.post('/api/connections/remove', { id: c.json.id });
  } finally { await h2.stop(); }
});
