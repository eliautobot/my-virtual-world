// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// OpenClaw → the universal chat (server/providers/openclaw/translate.js), replaying frames recorded from a real OpenClaw
// 2026.9.6 gateway (tests/fixtures/openclaw/run-*.json): a command run with its live output, an approval, reasoning; and
// the history, model list and session rows the chat window draws from.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { RunTranslator, historyOf, modelsOf, sessionOf, toolKind, phaseText, splitMedia, mediaBlocks, mergeMedia } from '../server/providers/openclaw/translate.js';
import { normalize } from '../server/providers/bus.js';

const fixture = n => JSON.parse(fs.readFileSync(new URL(`./fixtures/openclaw/${n}.json`, import.meta.url), 'utf8'));
/** Every event the frames make, each through the bus's whitelist (as the adapter sends them). */
function replay(n) {
  const f = fixture(n), out = [];
  const t = new RunTranslator({ emit: e => out.push(normalize({ ...e, kind: 'openclaw', connectionId: '1', agentKey: 'prov-1-tester', sessionKey: 'k', runId: f.runId })) });
  for (const fr of f.frames) t.feed(fr);
  return { f, out, t };
}

test('a command run: its phases, its step with title, kind, command, live output, exit code and time, then the answer', () => {
  const { out } = replay('run-tool');
  const types = out.map(e => e.type);
  assert.ok(types.indexOf('run.status') < types.indexOf('tool.start'), 'what it is doing comes first');
  assert.ok(out.some(e => e.type === 'run.status' && e.phase === 'Reading the conversation'));
  const start = out.find(e => e.type === 'tool.start');
  assert.equal(start.name, 'exec'); assert.equal(start.toolKind, 'execute'); assert.match(start.title, /^Exec /);
  const input = start.input || out.find(e => e.type === 'tool.update' && e.input)?.input;
  assert.equal(input, 'echo hello-from-tool && ls');
  assert.ok(out.some(e => e.type === 'tool.update' && /hello-from-tool/.test(e.text || '')), 'the output as it comes');
  const end = out.find(e => e.type === 'tool.end');
  assert.equal(end.ok, true); assert.equal(end.exitCode, 0); assert.ok(Number.isFinite(end.ms)); assert.match(end.text, /AGENTS\.md/);
  const fin = out[out.length - 1];
  assert.equal(fin.type, 'run.end'); assert.equal(fin.status, 'ok'); assert.match(fin.text, /The tool answered/);
  assert.equal(fin.model, 'stub/stub-1');
  const pieces = out.filter(e => e.type === 'run.delta' && e.text).map(e => e.text).join('');
  assert.equal(pieces, fin.text, 'the pieces add up to the answer');
});

test('an approval: what it asks (the command, where, the choices), then how it was answered', () => {
  const { out } = replay('run-approval');
  const a = out.find(e => e.type === 'approval.requested');
  assert.equal(a.approvalKind, 'exec'); assert.equal(a.title, 'Run a command');
  assert.equal(a.command, 'echo approved-run && date +%Y'); assert.equal(a.cwd, '/srv/openclaw/workspace');
  assert.deepEqual(a.options, ['allow-once', 'allow-always', 'deny']);
  assert.ok(out.some(e => e.type === 'run.status' && e.phase === 'Waiting for your approval'));
  const r = out.find(e => e.type === 'approval.resolved');
  assert.equal(r.approvalId, a.approvalId); assert.equal(r.approved, true); assert.equal(r.decision, 'allow-once');
  assert.ok(out.findIndex(e => e.type === 'approval.resolved') < out.findIndex(e => e.type === 'tool.end'), 'the command runs once allowed');
});

test('reasoning streams as thinking, apart from the answer, and ends with it', () => {
  const { out } = replay('run-thinking');
  const thought = out.filter(e => e.type === 'run.delta' && e.thinking).map(e => e.thinking).join('');
  assert.equal(thought, 'Let me think about this step by step.');
  const fin = out.find(e => e.type === 'run.end');
  assert.equal(fin.thinking, thought); assert.equal(fin.model, 'stub/stub-2');
});

test('a stop and an error end the run as such', () => {
  const ev = [];
  const t = new RunTranslator({ emit: e => ev.push(e) });
  t.feed({ event: 'chat', payload: { state: 'delta', deltaText: 'Half an ans' } });
  assert.equal(t.feed({ event: 'chat', payload: { state: 'aborted', stopReason: 'user' } }), true);
  assert.deepEqual([ev.at(-1).type, ev.at(-1).status, ev.at(-1).text], ['run.end', 'stopped', 'Half an ans']);
  const ev2 = [], t2 = new RunTranslator({ emit: e => ev2.push(e) });
  t2.feed({ event: 'chat', payload: { state: 'error', errorMessage: 'The model refused', errorKind: 'rate_limit', errorDetail: { provider: 'stub', httpStatus: 429 } } });
  assert.equal(ev2[0].status, 'error'); assert.match(ev2[0].error, /The model refused \(stub 429\)/);
  // a rewrite of the answer so far replaces it
  const ev3 = [], t3 = new RunTranslator({ emit: e => ev3.push(e) });
  t3.feed({ event: 'chat', payload: { state: 'delta', deltaText: 'Draft' } });
  t3.feed({ event: 'chat', payload: { state: 'delta', deltaText: 'Final words', replace: true } });
  assert.deepEqual(ev3[1], { type: 'run.delta', text: 'Final words', replace: true });
});

test('history: the person\'s messages and each answer with its reasoning and steps (the tool call and its result)', () => {
  const h = historyOf(fixture('run-tool').history);
  assert.deepEqual(h.map(m => m.role), ['user', 'assistant']);
  const a = h[1];
  assert.match(a.text, /The tool answered/);
  assert.equal(a.meta.steps.length, 1);
  assert.deepEqual({ name: a.meta.steps[0].name, input: a.meta.steps[0].input, ok: a.meta.steps[0].ok, kind: a.meta.steps[0].kind },
    { name: 'exec', input: 'echo hello-from-tool && ls', ok: true, kind: 'execute' });
  assert.match(a.meta.steps[0].output, /AGENTS\.md/);
  assert.equal(a.meta.model, 'stub/stub-1');
  const t = historyOf(fixture('run-thinking').history);
  assert.equal(t[1].meta.thinking, 'Let me think about this step by step.');
  assert.deepEqual(historyOf([{ role: 'assistant', content: [], __openclaw: { kind: 'compaction' } }]).map(m => m.status), ['compaction']);
});

test('models, sessions and the context meter', () => {
  const m = modelsOf({ models: [
    { id: 'stub-1', name: 'Stub One', provider: 'stub', contextWindow: 128000, tags: ['default'], thinkingLevels: [{ id: 'off', label: 'off' }], available: true },
    { id: 'stub-2', name: 'Stub Two', provider: 'stub', contextWindow: 32000, reasoning: true, thinkingLevels: [{ id: 'off', label: 'off' }, { id: 'high', label: 'high' }], thinkingDefault: 'high', available: true },
    { id: 'gone', provider: 'x', available: false }] });
  assert.equal(m.default, 'stub/stub-1');
  assert.deepEqual(m.models.map(x => x.id), ['stub/stub-1', 'stub/stub-2']);
  assert.deepEqual(m.models[1].effort.map(x => x.id), ['off', 'high']); assert.equal(m.models[1].effortDefault, 'high');
  const info = fixture('run-tool').sessionInfo;
  const s = sessionOf({ ...info, lastMessagePreview: 'hello there' });
  assert.equal(s.model, 'stub/stub-1'); assert.equal(s.usage.size, 128000); assert.ok(s.usage.used > 0);
  assert.equal(sessionOf({ key: 'k', label: 'Mine', derivedTitle: 'x' }).title, 'Mine');
  assert.equal(toolKind('apply_patch'), 'edit'); assert.equal(toolKind('web_fetch'), 'fetch'); assert.equal(toolKind('read'), 'read');
  assert.equal(phaseText('starting_model'), 'Starting the model'); assert.equal(phaseText('new_phase_x'), 'New phase x');
});

test('the agent asks: its question with its options and a free answer; the answer comes back', () => {
  const { out } = replay('run-question');
  const q = out.find(e => e.type === 'question.requested');
  assert.equal(q.questions.length, 1);
  assert.deepEqual(q.questions[0], { questionId: 'colour', header: 'Colour', question: 'Which colour do you like?', options: [{ label: 'Blue', description: 'Calm' }, { label: 'Red' }], multiSelect: false, other: true, secret: false });
  assert.ok(out.some(e => e.type === 'run.status' && e.phase === 'Waiting for your answer'));
  assert.equal(out.some(e => /^tool\./.test(e.type)), false, 'the question is its card: no step for ask_user, nor for the tool_call that carried it');
  const r = out.find(e => e.type === 'question.resolved');
  assert.equal(r.questionId, q.questionId); assert.equal(r.status, 'answered'); assert.deepEqual(r.answers, { colour: ['Blue'] });
  // a secret's answer never travels on
  const ev = [], t = new RunTranslator({ emit: e => ev.push(e) });
  t.feed({ event: 'question.requested', payload: { id: 'q1', questions: [{ questionId: 'k', header: 'Key', question: 'Your API key?', options: [], isSecret: true }] } });
  t.feed({ event: 'question.resolved', payload: { id: 'q1', status: 'answered', answers: { answers: { k: ['sk-SECRET'] } } } });
  assert.equal(JSON.stringify(ev).includes('sk-SECRET'), false);
});

test('the plan: its steps as they stand, from the run\'s plan stream and the session\'s progress card', () => {
  const { out } = replay('run-plan');
  const p = out.find(e => e.type === 'plan.update');
  assert.deepEqual(p.steps, [{ step: 'Read the files', status: 'completed' }, { step: 'Write the summary', status: 'in_progress' }, { step: 'Check it', status: 'pending' }]);
  assert.equal(p.explanation, '1/3 complete');
  assert.equal(out.some(e => /^tool\./.test(e.type)), false, 'the plan is its card, not a step');
  const ev = [], t = new RunTranslator({ emit: e => ev.push(e) });
  t.feed({ event: 'progress.card', payload: { sessionKey: 'k', revision: 2, updatedAt: 1792170000000, markdown: 'Reviewing the docs', steps: [{ step: 'A', status: 'completed' }] } });
  assert.deepEqual(ev[0], { type: 'plan.update', title: 'Plan', steps: [{ step: 'A', status: 'completed' }], markdown: 'Reviewing the docs', revision: 2, updatedAt: 1792170000000 });
  // (taken off — dismissed, or the session reset: no card) — an empty one, so the chat drops it
  t.feed({ event: 'progress.card', payload: null });
  assert.deepEqual(ev[1], { type: 'plan.update', title: 'Plan', steps: [], markdown: '' });
});

test('slash commands: name, alias, what it does and its arguments; the native-only ones are left out', async () => {
  const { commandsOf } = await import('../server/providers/openclaw/translate.js');
  const c = commandsOf({ commands: [
    { name: 'help', textAliases: ['/help'], description: 'Show available commands.', scope: 'both', acceptsArgs: false },
    { name: 'skill', textAliases: ['/skill'], description: 'Run a skill by name.', scope: 'both', args: [{ name: 'name', description: 'Skill name', required: true }] },
    { name: 'native', description: 'x', scope: 'native' }] });
  assert.deepEqual(c.map(x => x.alias), ['/help', '/skill']);
  assert.deepEqual(c[1].args, [{ name: 'name', description: 'Skill name', required: true, choices: undefined }]);
});

test('media: an agent\'s MEDIA lines leave the text (not in a code block), its kept blocks are read, the same file once', () => {
  const t = splitMedia('Here.\nMEDIA:/w/a.png\n  MEDIA: `clip.mp4`\n```\nMEDIA:/not/an/attachment.png\n```\nMEDIA:\nDone');
  assert.equal(t.text, 'Here.\n```\nMEDIA:/not/an/attachment.png\n```\nMEDIA:\nDone', 'a line in a code block, and an empty one, stay text');
  assert.deepEqual(t.media, [{ kind: 'image', name: 'a.png', ref: { source: '/w/a.png' } }, { kind: 'video', name: 'clip.mp4', ref: { source: 'clip.mp4' } }]);
  assert.deepEqual(splitMedia('no media here'), { text: 'no media here', media: [] });
  const blocks = mediaBlocks([{ type: 'text', text: 'x' }, { type: 'image', artifactId: 'art1', alt: 'a.png', mimeType: 'image/png', width: 4, height: 3, sizeBytes: 99 },
    { type: 'video', artifactId: 'art2', fileName: 'v.mp4', mimeType: 'video/mp4' }, { type: 'image', url: '/no/id' }]);
  assert.deepEqual(blocks, [{ kind: 'image', name: 'a.png', mime: 'image/png', w: 4, h: 3, size: 99, ref: { artifactId: 'art1' } },
    { kind: 'video', name: 'v.mp4', mime: 'video/mp4', ref: { artifactId: 'art2' } }], 'only the ones OpenClaw keeps (an artifact id)');
  assert.deepEqual(mergeMedia(t.media, blocks).map(m => m.ref), [{ artifactId: 'art1' }, { source: 'clip.mp4' }, { artifactId: 'art2' }], 'a kept block replaces a path to the same file');
  // in the history: the answer's text without the lines, its media in its meta
  const h = historyOf([{ role: 'user', content: 'show me' }, { role: 'assistant', content: [{ type: 'text', text: 'Done.\nMEDIA:/w/a.png' }, { type: 'video', artifactId: 'art2', fileName: 'v.mp4' }] }]);
  assert.equal(h[1].text, 'Done.'); assert.deepEqual(h[1].meta.media.map(m => m.name), ['a.png', 'v.mp4']);
  assert.equal(historyOf([{ role: 'assistant', content: [{ type: 'text', text: 'MEDIA:/w/only.png' }] }])[0].meta.media.length, 1, 'an answer that is only media is kept');
  // a run's end: its final text without the lines, the media with it; through the bus, rebuilt field by field
  const out = [];
  const tr = new RunTranslator({ emit: e => out.push(e) });
  tr.feed({ event: 'chat', payload: { state: 'final', message: { content: [{ type: 'text', text: 'All set.\nMEDIA:https://example.com/x.jpg' }] } } });
  const end = out.find(e => e.type === 'run.end');
  assert.equal(end.text, 'All set.'); assert.deepEqual(end.media, [{ kind: 'image', name: 'x.jpg', ref: { source: 'https://example.com/x.jpg' } }]);
  const bus = normalize({ ...end, kind: 'openclaw', connectionId: '1', runId: 'r1', media: [...end.media, { kind: 'evil', name: 'n', ref: { source: 's' }, data: 'BYTES', mime: 'not a type' }, { name: 'no ref' }] });
  assert.deepEqual(bus.media, [{ kind: 'image', name: 'x.jpg', ref: { source: 'https://example.com/x.jpg' } }, { kind: 'file', name: 'n', ref: { source: 's' } }], 'nothing else travels');
});

// (recorded from OpenClaw 2026.9.6 with tools offered by search: the agent calls tool_call { id: 'browser' }, and OpenClaw
// reports the browser call itself — parentToolCallId naming the tool_call — live and in the history)
test('a deferred-tool call shows as the tool it called (live and in the history), and a browser tab it left as such', () => {
  const ev = [], t = new RunTranslator({ emit: e => ev.push(e) });
  const tab = { targetId: '5B9D6553178000D01D47D940D225E760', profile: 'openclaw', target: 'host', url: 'https://example.com/', title: 'Example Domain' };
  const agent = data => t.feed({ event: 'agent', payload: { stream: data.stream, data } });
  agent({ stream: 'item', itemId: 'tool:call_1', toolCallId: 'call_1', name: 'tool_call', kind: 'tool', phase: 'start', title: 'Tool Call', status: 'running' });
  agent({ stream: 'tool', phase: 'start', name: 'tool_call', toolCallId: 'call_1', args: { id: 'browser', args: { action: 'open', url: 'https://example.com' } } });
  agent({ stream: 'item', toolCallId: 'tsc:call_1:browser:1', name: 'browser', kind: 'tool', phase: 'start', title: 'Browser', status: 'running' });
  agent({ stream: 'tool', phase: 'start', name: 'browser', toolCallId: 'tsc:call_1:browser:1', parentToolCallId: 'call_1', args: { action: 'open', url: 'https://example.com' } });
  agent({ stream: 'tool', phase: 'result', name: 'browser', toolCallId: 'tsc:call_1:browser:1', parentToolCallId: 'call_1', isError: false, result: { content: [{ type: 'text', text: '{"targetId":"5B9D"}' }], details: { browserTab: tab } } });
  agent({ stream: 'tool', phase: 'result', name: 'tool_call', toolCallId: 'call_1', isError: false, result: { content: [{ type: 'text', text: 'wrapped' }], details: {} } });
  const steps = ev.filter(e => e.type === 'tool.start' || e.type === 'tool.end');
  assert.ok(ev.some(e => e.type === 'tool.update' && /example\.com/.test(e.input || '')), 'what it was given');
  assert.deepEqual(steps.map(e => [e.type, e.name, e.title]), [['tool.start', 'browser', 'Browser'], ['tool.end', 'browser', 'Browser']], 'the browser call is the step; the wrapper never shows');
  assert.deepEqual(steps[1].tab, { targetId: tab.targetId, url: tab.url, title: 'Example Domain' });
  assert.deepEqual(normalize({ ...steps[1], kind: 'openclaw', connectionId: '1', runId: 'r' }).tab, { targetId: tab.targetId, url: tab.url, title: 'Example Domain' }, 'through the bus');
  // a gateway that doesn't report what the wrapper called: the wrapper, at its end
  const ev2 = [], t2 = new RunTranslator({ emit: e => ev2.push(e) });
  t2.feed({ event: 'agent', payload: { stream: 'tool', data: { phase: 'start', name: 'tool_call', toolCallId: 'c9', args: { id: 'web_fetch', args: {} } } } });
  t2.feed({ event: 'agent', payload: { stream: 'tool', data: { phase: 'result', name: 'tool_call', toolCallId: 'c9', isError: false, result: { content: [{ type: 'text', text: 'ok' }] } } } });
  assert.deepEqual(ev2.filter(e => /^tool\./.test(e.type)).map(e => [e.type, e.name || '']), [['tool.start', 'tool_call'], ['tool.end', 'tool_call']]);
  // the history: the custom entries are the calls a wrapper made, and their results
  const h = historyOf([
    { role: 'user', content: 'open it', timestamp: 1 },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'call_1', name: 'tool_call', arguments: { id: 'browser', args: { action: 'open', url: 'https://example.com' } } }], timestamp: 2 },
    { role: 'custom', content: [{ type: 'toolCall', id: 'tsc:call_1:browser:1', name: 'browser', arguments: { action: 'open', url: 'https://example.com' }, parentToolCallId: 'call_1' }] },
    { role: 'custom', content: [{ type: 'toolResult', toolCallId: 'tsc:call_1:browser:1', toolName: 'browser', parentToolCallId: 'call_1', isError: false, content: [{ type: 'text', text: 'opened' }], details: { browserTab: tab } }] },
    { role: 'toolResult', toolCallId: 'call_1', toolName: 'tool_call', isError: false, content: [{ type: 'text', text: 'wrapped' }] },
    { role: 'custom', content: [{ type: 'toolCall', id: 'tsc:call_2:progress_card:1', name: 'progress_card', arguments: {}, parentToolCallId: 'call_2' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Done.' }], timestamp: 3 },
  ]);
  const st = h[1].meta.steps;
  assert.deepEqual(st.map(x => [x.name, x.title, x.output]), [['browser', 'Browser', 'opened']]);
  assert.deepEqual(st[0].tab, { targetId: tab.targetId, url: tab.url, title: 'Example Domain' });
  assert.equal(h[1].text, 'Done.');
});
