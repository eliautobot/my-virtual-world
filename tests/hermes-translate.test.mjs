// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Hermes → the universal chat (server/providers/hermes/translate.js), replaying frames recorded from a real Hermes 0.21.5
// backend (tests/fixtures/hermes/run-*.json: its gateway JSON-RPC events and its requests to the client): reasoning, a
// command with its output, an approval, the agent's questions, commentary beside a tool, a model failure; and the
// stored messages, model inventory, session rows and slash commands the chat window draws from.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { RunTranslator, historyOf, modelsOf, sessionOf, commandsOf, approvalOf, questionsOf, answerFor, toolKind, waitText, statusText, stepsOf, resultOf, parseModelRef, modelRef, skillInvocationText } from '../server/providers/hermes/translate.js';
import { normalize } from '../server/providers/bus.js';
import { nativeCall, nativeResult, sideOf, controlOf } from '../server/providers/hermes/native.js';

const fixture = n => JSON.parse(fs.readFileSync(new URL(`./fixtures/hermes/${n}.json`, import.meta.url), 'utf8'));
/** Every event a recorded turn makes, each through the bus's whitelist (as the adapter sends them). */
function replay(n) {
  const f = fixture(n), out = [];
  const t = new RunTranslator({ emit: e => out.push(normalize({ ...e, kind: 'hermes', connectionId: '1', agentKey: 'prov-1-default', sessionKey: 's', runId: 'r1' })) });
  for (const fr of f.frames) if (fr.type) t.feed(fr);
  return { f, out, t };
}
const deltas = (out, k) => out.filter(e => e.type === 'run.delta' && e[k]).map(e => e[k]).join('');

test('reasoning streams as reasoning, the answer as text; Hermes\' spinner lines are not said', () => {
  const { out } = replay('run-think');
  assert.equal(deltas(out, 'thinking'), 'Let me think about this step by step.');
  const end = out.at(-1);
  assert.equal(end.type, 'run.end'); assert.equal(end.status, 'ok');
  assert.match(end.text, /^Stub reply \d+ to: hello there/);
  assert.match(end.text, /Paragraph 1:/);
  assert.equal(end.thinking, 'Let me think about this step by step.');
  assert.ok(Number.isFinite(end.tokensIn) && Number.isFinite(end.tokensOut));
  // (its kaomoji "processing…" lines are decoration, as its Desktop treats them)
  assert.ok(!out.some(e => e.type === 'run.status' && /[˘ಠ]|processing|cogitating/.test(e.phase)));
  // (reasoning.available relays the model's own words once they streamed: never a second copy of the answer)
  assert.ok(!/Stub reply/.test(end.thinking));
  assert.ok(out.some(e => e.type === 'usage.update' && e.used > 0 && e.size === 256000), 'the context meter');
});

test('a command: its step with title, kind, input, output, exit code and time, then the answer', () => {
  const { out } = replay('run-tool');
  const start = out.find(e => e.type === 'tool.start');
  assert.equal(start.name, 'terminal'); assert.equal(start.toolKind, 'execute'); assert.equal(start.title, 'Terminal');
  assert.match(start.input, /^echo hello-from-tool/);
  assert.ok(out.findIndex(e => e.type === 'run.status' && e.phase === 'Preparing Terminal') < out.indexOf(start), 'its arguments being written comes first');
  const end = out.find(e => e.type === 'tool.end');
  assert.equal(end.ok, true); assert.equal(end.exitCode, 0); assert.equal(end.status, 'completed');
  assert.equal(end.text, 'hello-from-tool\nsecond-line'); assert.ok(Number.isFinite(end.ms));
  assert.equal(out.at(-1).type, 'run.end');
  assert.match(out.at(-1).text, /The tool answered/);
});

test('an approval: Hermes\' request as the chat\'s approval, with its four choices; denied, the step says it was blocked', () => {
  const { f, out } = replay('run-approval');
  const rq = f.frames.find(x => x.request).request;
  const a = normalize({ ...approvalOf(rq), kind: 'hermes', connectionId: '1', runId: 'r1' });
  assert.equal(a.approvalId, rq.params.request_id);
  assert.equal(a.command, 'rm -rf /tmp/lab');
  assert.equal(a.summary, 'delete in root path');
  assert.deepEqual(a.options, ['allow-once', 'allow-session', 'allow-always', 'deny']);
  const end = out.find(e => e.type === 'tool.end');
  assert.equal(end.ok, false); assert.equal(end.status, 'blocked'); assert.match(end.text, /did not run/);
});

test('the agent\'s questions (clarify): each with its choices and a free answer; the answers go back by Hermes\' question ids', () => {
  const { f, out } = replay('run-clarify');
  const rq = f.frames.find(x => x.request).request;
  const qs = questionsOf(rq);
  const e = normalize({ type: 'question.requested', questionId: rq.id, questions: qs, kind: 'hermes', connectionId: '1', runId: 'r1' });
  assert.equal(e.questions.length, 2);
  assert.deepEqual(e.questions[0].options.map(o => o.label), ['Red (Recommended)', 'Blue']);
  assert.equal(e.questions[1].options.length, 0); assert.equal(e.questions[1].other, true);
  assert.deepEqual(answerFor(rq, { q0: ['Blue'], q1: ['Nothing'] }), { answers: { q0: 'Blue', q1: 'Nothing' } });
  assert.deepEqual(answerFor(rq, null, true), {});
  assert.ok(!out.some(x => /^tool\./.test(x.type)), 'its question card shows it: no step for clarify');
  // a masked prompt is a secret question: its answer is a value, never shown back
  const s = questionsOf({ id: 'x', method: 'secret', params: { env_var: 'GITHUB_TOKEN', prompt: 'Your GitHub token' } });
  assert.equal(s[0].secret, true);
  assert.deepEqual(answerFor({ method: 'secret' }, { value: ['abc'] }), { value: 'abc' });
});

test('commentary beside a tool and the answer after it: one answer, a paragraph apart, as Hermes\' history keeps them', () => {
  const { out } = replay('run-interim');
  const end = out.at(-1);
  assert.equal(end.status, 'ok');
  const text = deltas(out, 'text');
  assert.ok(end.text.length > 0);
  assert.ok(text.replace(/\s+/g, ' ').trim().endsWith(end.text.split('\n\n').at(-1).replace(/\s+/g, ' ').trim()), 'what streamed ends with the answer');
});

test('a model that keeps failing: Hermes\' retries are said, the run ends with its error', { skip: !fs.existsSync(new URL('./fixtures/hermes/run-error.json', import.meta.url)) }, () => {
  const { out } = replay('run-error');
  assert.ok(out.some(e => e.type === 'run.status' && /Provider temporarily unavailable/.test(e.phase)));
  const end = out.at(-1);
  if (end.type === 'run.end') { assert.equal(end.status, 'error'); assert.ok(end.error); }
});

test('a turn Hermes ended: stopped, failed, the media lines of an answer', () => {
  const out = [];
  const t = new RunTranslator({ emit: e => out.push(normalize({ ...e, kind: 'hermes', connectionId: '1', runId: 'r1' })) });
  t.feed({ type: 'message.start', payload: {} });
  t.feed({ type: 'message.delta', payload: { text: 'Here is the chart:\nMEDIA:/tmp/chart.png\n' } });
  t.feed({ type: 'message.complete', payload: { text: 'Here is the chart:\nMEDIA:/tmp/chart.png', status: 'complete', usage: { model: 'gpt-x', input: 3, output: 4 } } });
  const end = out.at(-1);
  assert.equal(end.text, 'Here is the chart:');
  assert.deepEqual(end.media, [{ kind: 'image', name: 'chart.png', ref: { source: '/tmp/chart.png' } }]);
  const out2 = [];
  const t2 = new RunTranslator({ emit: e => out2.push(e) });
  t2.feed({ type: 'message.start', payload: {} }); t2.feed({ type: 'message.delta', payload: { text: 'half' } });
  t2.feed({ type: 'message.complete', payload: { status: 'interrupted' } });
  assert.equal(out2.at(-1).status, 'stopped'); assert.equal(out2.at(-1).text, 'half');
  const out3 = [];
  const t3 = new RunTranslator({ emit: e => out3.push(e) });
  t3.feed({ type: 'message.complete', payload: { status: 'error', error: 'HTTP 500: stub error 500' } });
  assert.equal(out3.at(-1).status, 'error'); assert.match(out3.at(-1).error, /500/);
});

test('small rules: tool kinds, waits said, status lines, todo steps, tool results', () => {
  assert.equal(toolKind('terminal'), 'execute'); assert.equal(toolKind('read_file'), 'read'); assert.equal(toolKind('search_files'), 'search');
  assert.equal(toolKind('patch'), 'edit'); assert.equal(toolKind('web_search'), 'search'); assert.equal(toolKind('browser_navigate'), 'fetch');
  assert.equal(waitText('( ˘⌣˘)♡ processing...'), '');
  assert.equal(waitText('⏳ still waiting on the provider (40s)'), 'still waiting on the provider (40s)');
  assert.equal(statusText({ kind: 'compacting', text: 'x' }), 'Compacting the conversation');
  assert.equal(statusText({ kind: 'lifecycle', text: '⏳ Provider temporarily unavailable' }), 'Provider temporarily unavailable');
  assert.equal(statusText({ kind: 'tip', text: 'a tip' }), '');
  assert.deepEqual(stepsOf([{ id: '1', content: 'Read', status: 'completed' }, { id: '2', content: 'Write', status: 'in_progress' }, { id: '3', content: 'Skip', status: 'cancelled' }, { id: '4', content: 'Ship' }]),
    [{ step: 'Read', status: 'completed' }, { step: 'Write', status: 'in_progress' }, { step: 'Skip (cancelled)', status: 'completed' }, { step: 'Ship', status: 'pending' }]);
  assert.deepEqual(resultOf('{"output":"x","exit_code":2,"error":null}'), { text: 'x', ok: false, exitCode: 2, blocked: false });
  assert.equal(resultOf({ output: '', error: 'boom' }).text, 'boom');
  assert.deepEqual(parseModelRef('openrouter:anthropic/claude-x'), { provider: 'openrouter', model: 'anthropic/claude-x' });
  assert.equal(modelRef('nous', 'hermes-5'), 'nous:hermes-5');
});

test('a tool reached through Hermes\' tool_call shows as the tool it called; in the history too', () => {
  const out = [];
  const t = new RunTranslator({ emit: e => out.push(e) });
  t.feed({ type: 'tool.generating', payload: { name: 'tool_call' } });
  t.feed({ type: 'tool.start', payload: { tool_id: 'c1', name: 'web_search', context: 'cats', args: { query: 'cats' } } });
  assert.ok(!out.some(e => e.type === 'run.status' && /Tool call/.test(e.phase)), 'nothing said of the wrapper');
  assert.equal(out.find(e => e.type === 'tool.start').name, 'web_search');
  const h = historyOf([{ role: 'user', content: 'q', active: 1 },
    { role: 'assistant', content: '', active: 1, tool_calls: [{ id: 'c1', function: { name: 'tool_call', arguments: JSON.stringify({ calls: [{ name: 'web_search', arguments: { query: 'cats' } }] }) } },
      { id: 'c2', function: { name: 'tool_call', arguments: JSON.stringify({ calls: [{ name: 'todo_list', arguments: { todos: [] } }] }) } }] },
    { role: 'tool', tool_call_id: 'c1', content: 'found', active: 1 }, { role: 'assistant', content: 'done', active: 1 }]);
  assert.deepEqual(h[1].meta.parts.filter(x => x.t === 'tool').map(x => [x.name, x.args, x.out || null]), [['web_search', '{"query":"cats"}', 'found'], ['todo_list', '{"todos":[]}', null]],
    'the Hermes view gets every call as Hermes made it, the called tool unwrapped (the todo list too: its view decides how it shows)');
  assert.equal(h[1].meta.steps, undefined, 'no universal steps beside the parts');
});

test('a todo list as the progress card', () => {
  const out = [];
  const t = new RunTranslator({ emit: e => out.push(normalize({ ...e, kind: 'hermes', connectionId: '1', runId: 'r1' })) });
  t.feed({ type: 'todo.updated', payload: { todos: [{ id: 'a', content: 'Look', status: 'completed' }, { id: 'b', content: 'Fix', status: 'in_progress' }], revision: 2 } });
  assert.equal(out[0].type, 'plan.update'); assert.equal(out[0].steps.length, 2); assert.equal(out[0].revision, 2);
});

test('the stored messages: the person\'s turns, each answer with its reasoning and steps (call and result); hidden rows not shown', () => {
  const rows = [
    { role: 'user', content: 'list files', timestamp: 1, active: 1 },
    { role: 'assistant', content: '', reasoning_content: 'I should use ls.', tool_calls: [{ id: 'c1', function: { name: 'terminal', arguments: '{"command":"ls"}' } }], timestamp: 2, active: 1 },
    { role: 'tool', tool_call_id: 'c1', content: '{"output":"a\\nb","exit_code":0,"error":null}', timestamp: 3, active: 1 },
    { role: 'assistant', content: 'Two files.\nMEDIA:/tmp/x.mp4', timestamp: 4, active: 1 },
    { role: 'user', content: 'scaffold', display_kind: 'hidden', timestamp: 5, active: 1 },
    { role: 'user', content: 'gone', timestamp: 6, active: 0 },
  ];
  const h = historyOf(rows);
  assert.equal(h.length, 2);
  assert.deepEqual(h[0], { role: 'user', text: 'list files', ts: 1000 });
  assert.equal(h[1].text, 'Two files.');
  assert.equal(h[1].meta.thinking, 'I should use ls.');
  // (the turn in Hermes' order, for the Hermes view: its reasoning, the call and its result, then its words)
  assert.deepEqual(h[1].meta.parts, [{ t: 'think', text: 'I should use ls.' },
    { t: 'tool', id: 'c1', name: 'terminal', args: '{"command":"ls"}', done: true, ok: true, out: 'a\nb', exit: 0 }, { t: 'text', text: 'Two files.' }]);
  assert.equal(h[1].meta.media[0].kind, 'video');
});

test('models, sessions and commands as the pickers and menus show them', () => {
  const m = modelsOf({ model: 'stub-1', provider: 'custom', providers: [
    { slug: 'custom', name: 'Custom', is_current: true, models: ['stub-1'], capabilities: { 'stub-1': { reasoning: false } } },
    { slug: 'anthropic', name: 'Anthropic', authenticated: true, models: ['claude-x', 'old'], unavailable_models: ['old'], capabilities: { 'claude-x': { reasoning: true, can_disable_reasoning: true } } },
    { slug: 'openai', name: 'OpenAI', authenticated: false, models: ['gpt'] }] });
  assert.equal(m.default, 'custom:stub-1');
  assert.deepEqual(m.models.map(x => x.id), ['custom:stub-1', 'anthropic:claude-x']);
  assert.deepEqual(m.models[1].effort.map(x => x.id), ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
  assert.equal(m.models[0].effort, undefined);
  const s = sessionOf({ id: '20261017_1', title: 'Plan the trip', source: 'telegram', model: 'm', last_activity_at: 1792220000, message_count: 4 });
  assert.deepEqual(s, { key: '20261017_1', title: 'Plan the trip', updatedAt: 1792220000000, model: 'm', source: 'telegram', messages: 4 });
  const c = commandsOf({ categories: [{ name: 'Session', pairs: [['/new', 'Start a new session (usage: /new [name])'], ['/model', 'Switch model (usage: /model <provider:model>)']] }], pairs: [['/new', 'dup']] });
  assert.deepEqual(c.map(x => x.name), ['new', 'model']);
  assert.equal(c[0].description, 'Start a new session');
  assert.equal(c[1].args[0].name, 'provider:model'); assert.equal(c[1].args[0].required, true);
});

test('Hermes\' own stream for its view: sections where they begin, every call with its arguments and result, in order', () => {
  const { out } = replay('run-tool');
  const ops = out.filter(e => e.type === 'native').map(e => e.ev);
  const start = ops.find(o => o.op === 'tool' && o.ph === 'start'), end = ops.find(o => o.op === 'tool' && o.ph === 'end');
  assert.equal(start.name, 'terminal'); assert.match(JSON.parse(start.args).command, /^echo hello-from-tool/);
  assert.equal(end.id, start.id); assert.equal(end.ok, true); assert.equal(end.exit, 0); assert.equal(end.out, 'hello-from-tool\nsecond-line'); assert.ok(Number.isFinite(end.ms));
  assert.ok(ops.indexOf(end) > ops.indexOf(start));
  // a text section after the call begins where the text after it begins (the run's text so far, counted as it streamed)
  const segs = ops.filter(o => o.op === 'seg' && o.k === 'text');
  const text = deltas(out, 'text');
  assert.ok(segs.length >= 1 && segs.every(o => o.at <= text.length));
  assert.match(text.slice(segs.at(-1).at).trimStart(), /^The tool answered/);
  // thinking sections likewise, in the reasoning
  const th = replay('run-think').out, tops = th.filter(e => e.type === 'native').map(e => e.ev);
  assert.deepEqual(tops.filter(o => o.op === 'seg').map(o => o.k), ['think', 'text']);
  // the questions are a call too (the view puts its card where Hermes asked), never a universal step
  const cl = replay('run-clarify').out;
  assert.ok(cl.some(e => e.type === 'native' && e.ev.op === 'tool' && e.ev.name === 'clarify'));
  assert.ok(!cl.some(x => /^tool\./.test(x.type)));
});

test('the bus rebuilds Hermes\' operations from its whitelist; anything else is refused', () => {
  const ok = normalize({ type: 'native', kind: 'hermes', connectionId: '1', runId: 'r1', ev: { op: 'tool', ph: 'end', id: 'x', name: 'terminal', out: 'y'.repeat(9000), secret: 'z', ok: true } });
  assert.equal(ok.ev.out.length, 4000); assert.equal(ok.ev.secret, undefined);
  assert.throws(() => normalize({ type: 'native', kind: 'hermes', connectionId: '1', runId: 'r1', ev: { op: 'eval', code: 'x' } }));
  assert.throws(() => normalize({ type: 'native', kind: 'openclaw', connectionId: '1', runId: 'r1', ev: { op: 'seg', k: 'text', at: 0 } }), 'a provider without a stream of its own sends none');
  const todo = normalize({ type: 'native', kind: 'hermes', connectionId: '1', runId: 'r1', ev: { op: 'todo', items: [{ text: 'a', status: 'weird' }, { nope: 1 }], rev: 3 } });
  assert.deepEqual(todo.ev, { op: 'todo', items: [{ text: 'a', status: 'pending' }], rev: 3 });
});

test('a turn stopped part-way: its hidden empty row shows what it wrote, from Hermes\' live transcript (as its Desktop does)', () => {
  const rows = [{ id: 1, role: 'user', content: 'go on', active: 1 }, { id: 2, role: 'assistant', content: '', display_kind: 'hidden', active: 1 },
    { id: 3, role: 'user', content: 'next', active: 1 }, { id: 4, role: 'assistant', content: 'done', active: 1 }];
  assert.deepEqual(historyOf(rows).map(m => m.role), ['user', 'user', 'assistant'], 'without the live transcript: hidden');
  const h = historyOf(rows, { visible: new Map([[2, { row_id: 2, text: 'Paragraph 1: half of it' }]]) });
  assert.deepEqual(h.map(m => [m.role, m.text]), [['user', 'go on'], ['assistant', 'Paragraph 1: half of it'], ['user', 'next'], ['assistant', 'done']]);
});

test('the bus keeps what a Hermes request says beyond its questions - never anything else', () => {
  const e = normalize({ type: 'native', kind: 'hermes', connectionId: '1', runId: 'r1', ev: { op: 'ask', id: 'srq-1', kind: 'sudo', command: 'apt-get update', value: 'x' } });
  assert.deepEqual(e.ev, { op: 'ask', id: 'srq-1', kind: 'sudo', command: 'apt-get update' });
  assert.throws(() => normalize({ type: 'native', kind: 'hermes', connectionId: '1', runId: 'r1', ev: { op: 'ask', id: 'x', kind: 'shell' } }));
});

test('Hermes\' own calls for its view: only the listed ones, their arguments rebuilt, never a session the page names; their answers rebuilt', () => {
  assert.equal(nativeCall('session.delete', {}), null);
  assert.equal(nativeCall('slash.exec', {}), null, 'a command needs its words');
  assert.deepEqual(nativeCall('slash.exec', { command: 'usage', session_id: 'other', profile: 'x' }), { method: 'slash.exec', params: { command: 'usage' }, session: 'need', timeoutMs: 90000 });
  assert.equal(nativeCall('config.set', { key: 'model', value: 'x' }), null);
  assert.equal(nativeCall('config.set', { key: 'yolo', value: '1', scope: 'global' }), null);
  assert.deepEqual(nativeCall('config.set', { key: 'reasoning', value: 'high', scope: 'global' }).params, { key: 'reasoning', value: 'high', scope: 'global' });
  assert.equal(nativeCall('session.compress', {}).timeoutMs, 660000);
  assert.equal(nativeCall('complete.path', { word: '@file:' }).session, 'opt');
  assert.equal(nativeCall('process.stop', {}).session, 'none');
  assert.deepEqual(nativeResult('session.save', { file: '/x.json', other: 1 }), { file: '/x.json' });
  assert.deepEqual(nativeResult('complete.slash', { items: [{ text: 'new', display: '/new', meta: 'm', kind: 'command', x: 1 }, { nope: 1 }], replace_from: 1 }), { items: [{ text: 'new', display: '/new', meta: 'm', kind: 'command' }], replace_from: 1 });
  const d = nativeResult('command.dispatch', { type: 'skill', name: 'work', message: 'body', display: '/work x', secret: 's' });
  assert.deepEqual(d, { type: 'skill', name: 'work', message: 'body', display: '/work x' });
  assert.equal(nativeResult('command.dispatch', { type: 'shell' }).type, undefined);
  const c = nativeResult('session.compress', { status: 'compressed', removed: 3, messages: [{}], summary: { headline: 'h', noop: false }, info: { title: 'T' }, usage: { context_used: 5, context_max: 10 } });
  assert.deepEqual(c, { status: 'compressed', removed: 3, summary: { headline: 'h', noop: false }, title: 'T', usage: { used: 5, size: 10 } });
  const cat = nativeResult('commands.catalog', { categories: [{ name: 'S', pairs: [['/new', 'n']] }], commands: { '/new': { desktop: null, x: 1 }, 'bad key': {} }, canon: { '/reset': '/new' }, skills: { '/a': {} } });
  assert.deepEqual(cat, { categories: [{ name: 'S', pairs: [['/new', 'n']] }], pairs: [], commands: { '/new': {} }, canon: { '/reset': '/new' } });
});

test('a side question or background task answered: its operation, to the bus as the session\'s own event', () => {
  const op = sideOf({ type: 'btw.complete', session_id: 's', payload: { task_id: 'btw_1', question: 'q?', text: 'a.', extra: 1 } });
  assert.deepEqual(op, { op: 'side', kind: 'btw', id: 'btw_1', question: 'q?', text: 'a.' });
  assert.deepEqual(sideOf({ type: 'background.complete', payload: { task_id: 'bg_1', text: 'done' } }), { op: 'side', kind: 'bg', id: 'bg_1', text: 'done' });
  assert.equal(sideOf({ type: 'message.complete', payload: {} }), null);
  assert.deepEqual(sideOf({ type: 'review.summary', payload: { text: '💾 Self-improvement review: Memory updated' } }), { op: 'side', kind: 'review', text: 'Self-improvement review: Memory updated' });
  const e = normalize({ type: 'session.native', kind: 'hermes', connectionId: '1', sessionKey: 'k', ev: op });
  assert.deepEqual(e.ev, op);
  assert.throws(() => normalize({ type: 'session.native', kind: 'hermes', connectionId: '1', sessionKey: 'k', ev: { op: 'side', kind: 'shell' } }));
});

test('a skill command Hermes stored as the skill\'s words is the command again (as its Desktop shows it)', () => {
  const single = '[IMPORTANT: The user has invoked the "work" skill, indicating they want you to follow its instructions. The full skill content is loaded below.]\n\nBody that quotes The user has provided the following instruction alongside the skill invocation: no\n\nThe user has provided the following instruction alongside the skill invocation: fix   the leak\n\n[Runtime note: x]';
  assert.equal(skillInvocationText(single), '/work fix the leak');
  assert.equal(skillInvocationText('[IMPORTANT: The user has invoked the "work" skill. The full skill content is loaded below.]\n\nbody'), '/work');
  assert.equal(skillInvocationText('hello'), null);
  const h = historyOf([{ id: 4, role: 'user', content: single, timestamp: 1 }, { id: 5, role: 'assistant', content: 'ok', timestamp: 2 }]);
  assert.deepEqual(h[0].meta, { row: 4, skill: true }); assert.equal(h[0].text, '/work fix the leak');
});

test('a wait on the provider names the status row as Hermes Desktop names it; its spinner words stay out; compacting says so', () => {
  const out = [];
  const t = new RunTranslator({ emit: e => out.push(normalize({ ...e, kind: 'hermes', connectionId: '1', runId: 'r1' })) });
  const st = () => out.filter(e => e.type === 'native' && e.ev.op === 'status').map(e => e.ev);
  t.feed({ type: 'message.start', payload: {} });
  t.feed({ type: 'thinking.delta', payload: { text: '(´･_･`) mulling...' } });
  t.feed({ type: 'thinking.delta', payload: { text: '⏳ waiting on provider - retrying in 2s (attempt 1/3)' } });
  t.feed({ type: 'thinking.delta', payload: { text: '' } });
  t.feed({ type: 'status.update', payload: { kind: 'lifecycle', text: '⏳ Provider temporarily unavailable - retrying automatically in 18s (cycle 1/5); send /stop to cancel' } });
  t.feed({ type: 'status.update', payload: { kind: 'compacting', text: 'Compressing…' } });
  t.feed({ type: 'status.update', payload: { kind: 'compacted', text: 'done' } });
  assert.deepEqual(st(), [{ op: 'status', kind: 'wait', text: '' }, { op: 'status', kind: 'wait', text: '⏳ waiting on provider - retrying in 2s (attempt 1/3)' },
    { op: 'status', kind: 'wait', text: '' }, { op: 'status', kind: 'compacting', text: 'Summarizing thread' }, { op: 'status', kind: 'compacting', text: '' }]);
  assert.ok(!out.some(e => e.type === 'run.delta' && /mulling/.test(e.thinking || e.text || '')), 'the spinner\'s words are not its reasoning');
});

test('a session\'s goal, loop and heartbeat rebuilt field by field; its actions only Hermes\' own, with what each needs', () => {
  const c = controlOf({ goal: { title: 'Ship it', status: 'weird', turns_used: 2, max_turns: 20, contract: { outcome: 'o', x: 1 }, subgoals: ['a', 3], gates: [{ command: 'npm test', attempts: 1, max_retries: 3, timeout_seconds: 60, last_exit_code: null, extra: 1 }], last_verdict: 'blocked', wait_barrier: { type: 'pid', target: 42, reason: 'build', more: 1 }, token: 's' },
    loop: { prompt: 'p', status: 'active', mode: 'interval', interval_seconds: 60, times: 3, ticks_fired: 1, next_due_at: 5, deferred_by_goal: true }, heartbeat: { prompt: 'h', status: 'paused', interval_seconds: 2700, fire_count: 4 }, revision: 'r', updated_at: 9, other: 1 });
  assert.deepEqual(c.goal, { title: 'Ship it', status: 'active', turns_used: 2, max_turns: 20, contract: { outcome: 'o' }, subgoals: ['a'], gates: [{ command: 'npm test', timeout_seconds: 60, max_retries: 3, attempts: 1, last_exit_code: null }], last_verdict: 'blocked', wait_barrier: { type: 'pid', target: 42, reason: 'build' } });
  assert.deepEqual(c.loop, { prompt: 'p', status: 'active', mode: 'interval', interval_seconds: 60, times: 3, ticks_fired: 1, next_due_at: 5, deferred_by_goal: true });
  assert.deepEqual(c.heartbeat, { prompt: 'h', status: 'paused', interval_seconds: 2700, fire_count: 4 });
  assert.equal(c.other, undefined); assert.equal(controlOf(null), null);
  assert.equal(nativeCall('session.control', { action: 'goal.explode' }), null);
  assert.equal(nativeCall('session.control', { action: 'subgoal.add', args: {} }), null);
  assert.deepEqual(nativeCall('session.control', { action: 'subgoal.remove', args: { index: 1, junk: 'x' } }).params, { action: 'subgoal.remove', args: { index: 1 } });
  assert.equal(nativeCall('session.control.read', {}).session, 'have');
  const e = normalize({ type: 'session.native', kind: 'hermes', connectionId: '1', sessionKey: 'k', ev: { op: 'control', control: { goal: null, loop: null, heartbeat: null, revision: 'r', updated_at: 1, x: 2 } } });
  assert.deepEqual(e.ev, { op: 'control', control: { goal: null, loop: null, heartbeat: null, revision: 'r', updated_at: 1 } });
});
