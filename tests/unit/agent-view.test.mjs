// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// How a connected agent is shown (client/js/core/agent-view.js; 2026-09-29: a connected agent must be visible and usable from the
// page): which agents have no body, what their state is called, and how the events of one chat run add up.
import assert from 'node:assert/strict';
import test from 'node:test';
import { bodylessAgents, isExt, reduceRun, runLine, stateOf } from '../../client/js/core/agent-view.js';

const ev = (type, o = {}, seq = 1) => ({ seq, event: { type, ...o } });

test('connected agents are recognised by their key, and only those without a body are listed on their own', () => {
  const list = [{ id: 1, key: 'vip-1', i: 3 }, { id: 2, key: 'ext-7', i: -1 }, { id: 3, key: 'ext-8', i: 5 }, { id: 4, key: 'ext-9' }];
  assert.deepEqual(list.map(isExt), [false, true, true, true]);
  assert.deepEqual(bodylessAgents(list).map(a => a.id), [2, 4]);
  assert.deepEqual(bodylessAgents(null), []); assert.equal(isExt(null), false);
});

test('the state of a connected agent: offline until it signs in, online when idle, working while it works', () => {
  assert.deepEqual([stateOf({}, null).key, stateOf({}, { state: 'offline' }).key, stateOf({}, { state: 'idle' }).key, stateOf({}, { working: true, state: 'working' }).key], ['offline', 'offline', 'online', 'working']);
  assert.equal(stateOf({ presence: { state: 'idle' } }).label, 'Online');
  assert.equal(stateOf({}, { working: true }).live, true); assert.equal(stateOf({}, null).live, false);
});

test('the events of a run add up to progress, tools, approvals and the answer', () => {
  const r = reduceRun([ev('run.start'), ev('run.progress', { text: 'Reading files', pct: 30 }), ev('tool.start', { toolId: 't1', name: 'shell', input: 'ls' }), ev('tool.end', { toolId: 't1', ok: true }),
    ev('approval.requested', { approvalId: 'p1', tool: 'shell', summary: 'rm -rf build' })]);
  assert.deepEqual([r.started, r.done, r.progress, r.pct], [true, false, 'Reading files', 30]);
  assert.deepEqual(r.tools, [{ id: 't1', name: 'shell', input: 'ls', ok: true, done: true }]);
  assert.deepEqual(r.approvals.map(a => [a.id, a.resolved]), [['p1', false]]);
  const r2 = reduceRun([...[ev('approval.requested', { approvalId: 'p1' })], ev('approval.resolved', { approvalId: 'p1', approved: false }), ev('run.end', { status: 'ok', text: 'All done' })]);
  assert.deepEqual([r2.done, r2.status, r2.text, r2.approvals[0].resolved, r2.approvals[0].approved], [true, 'ok', 'All done', true, false]);
  assert.equal(reduceRun([ev('run.end', { status: 'error', error: 'It broke' })]).error, 'It broke');
  assert.deepEqual(reduceRun(null).tools, []); assert.equal(reduceRun([{}, null, ev('nonsense')]).done, false);
});

test('one line says where a waiting run is, and says so when the agent is offline (the message waits up to a day)', () => {
  const off = { key: 'offline' }, on = { key: 'online' };
  assert.match(runLine(reduceRun([]), off), /offline.*waits/i);
  assert.match(runLine(reduceRun([]), on), /Waiting for the agent/);
  assert.equal(runLine(reduceRun([ev('run.start')]), on), 'Working…');
  assert.equal(runLine(reduceRun([ev('run.start'), ev('run.progress', { text: 'Thinking', pct: 41.6 })]), on), 'Thinking (42%)');
  assert.equal(runLine(reduceRun([ev('approval.requested', { approvalId: 'p' })]), on), 'Waiting for your approval');
  assert.equal(runLine(reduceRun([ev('run.end', { status: 'ok' })]), on), '');
  assert.equal(runLine(reduceRun([ev('run.end', { status: 'stopped' })]), on), 'Stopped');
  assert.equal(runLine(reduceRun([ev('run.end', { status: 'error', error: 'Nope' })]), on), 'Nope');
  assert.equal(runLine(null), '');
});

test('a connected agent\'s body reads as that agent to its owner: name, agent marks, and nothing changes for other residents', async () => {
  const { overlayPerson } = await import('../../client/js/core/agent-view.js');
  const rec = { key: 'ext-7', id: 3, name: 'Codex', emoji: '🤖', role: 'Coding agent', i: 41 };
  const citizen = { i: 41, id: 'nabc12', n: 'Mara Lindqvist', v: 0, e: '', r: '', ag: '', jt: 'Office worker' };
  const shown = overlayPerson(citizen, rec);
  assert.deepEqual([shown.n, shown.v, shown.ag, shown.e, shown.r], ['Codex', 1, 'ext-7', '🤖', 'Coding agent']);
  assert.equal(shown.id, 'nabc12'); assert.equal(shown.jt, 'Office worker'); assert.equal(citizen.n, 'Mara Lindqvist', 'the received resident is not mutated');
  assert.equal(overlayPerson(shown, rec), shown, 'applying it again changes nothing (no update loops)');
  assert.equal(overlayPerson(citizen, { ...rec, key: 'vip-x' }), citizen, 'only connected agents');
  assert.equal(overlayPerson(citizen, null), citizen); assert.equal(overlayPerson(null, rec), null);
  assert.equal(overlayPerson({ ...citizen, x: 1 }, rec).v, 0, 'a retired body is not shown as an agent');
  assert.equal(overlayPerson(citizen, { key: 'ext-9', name: 'Ada' }).r, 'AI agent', 'a role is always shown');
});
