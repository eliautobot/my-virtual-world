// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The presence coordinator (server/presence-coordinator.js, PLAN WP2.3; DECISIONS A8, C120; CHECKLIST I8.6): scenario tests with a
// fake clock and the real event bus: long quiet runs, failed runs, crashes and restarts, approvals, overlapping runs,
// and that events for one agent never touch another.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PresenceCoordinator } from '../../server/presence-coordinator.js';
import { EventBus } from '../../server/providers/bus.js';

const MIN = 60000;
function rig() {
  let t = 1_000_000;
  const bus = new EventBus();
  const list = [
    { id: 1, key: 'main', enabled: true, connectionId: 7, nativeId: null },
    { id: 2, key: 'coder', enabled: true, connectionId: 7, nativeId: 'coder-native' },
    { id: 3, key: 'solo', enabled: true, connectionId: null, nativeId: null },
  ];
  const conns = { 7: { id: 7, enabled: true, kind: 'mock' } }, impl = { mock: true };
  const limits = { graceMs: 8000, quietMs: 60 * MIN }, changes = [], seen = [];
  const pc = new PresenceCoordinator({
    bus, agents: { list: () => list, byKey: k => list.find(a => a.key === k) || null }, connections: { get: id => conns[id] || null },
    registry: { implemented: k => !!impl[k] }, limits: () => limits, now: () => t,
    onChange: (k, i, x) => changes.push([k, i.state, x.workingChanged]),
  });
  bus.on(e => seen.push(e));
  const ev = (type, o = {}) => bus.emit({ type, kind: 'mock', connectionId: '7', agentKey: 'main', ...o });
  return { pc, bus, ev, changes, seen, limits, conns, impl, list, advance: ms => { t += ms; }, tick: ms => { t += ms; pc.tick(); } };
}

test('an agent with a working connection is idle, one with none is offline, and nothing reports on an unknown agent', () => {
  const r = rig();
  assert.equal(r.pc.info('main').state, 'idle'); assert.equal(r.pc.info('main').working, false);
  assert.equal(r.pc.info('solo'), null, 'no connection: nothing to report'); assert.equal(r.pc.stateOf('solo').state, 'offline');
  r.conns[7].enabled = false; assert.equal(r.pc.stateOf('main').state, 'offline', 'a switched-off connection');
  r.conns[7].enabled = true; r.impl.mock = false; assert.equal(r.pc.stateOf('main').state, 'offline', 'an adapter that does not exist yet');
  assert.equal(r.pc.stateOf('nobody').state, 'offline'); assert.equal(r.pc.live(), false);
  r.impl.mock = true; assert.equal(r.pc.live(), true);
});

test('a run makes the agent work, shows what it does, then finishes with a short grace and goes idle', () => {
  const r = rig();
  r.ev('run.start', { runId: 'a1' });
  assert.deepEqual([r.pc.info('main').state, r.pc.info('main').working], ['working', true]);
  r.ev('run.progress', { runId: 'a1', text: '  Reading   the file\nnow ' }); assert.equal(r.pc.info('main').task, 'Reading the file now');
  r.ev('tool.start', { runId: 'a1', toolId: 't1', name: 'shell' }); assert.equal(r.pc.info('main').task, 'Using shell');
  r.ev('run.end', { runId: 'a1', status: 'ok', text: 'done' });
  assert.deepEqual([r.pc.info('main').state, r.pc.info('main').working, r.pc.info('main').task], ['finishing', true, ''], 'still at the desk for the grace period');
  r.advance(7999); assert.equal(r.pc.info('main').state, 'finishing');
  r.tick(1); assert.equal(r.pc.info('main').state, 'idle');
  assert.deepEqual(r.changes, [['main', 'working', true], ['main', 'finishing', false], ['main', 'idle', true]], 'state changes only: progress and tools do not repeat');
  assert.equal(r.pc.info('main').lastRunError, null); assert.equal(r.pc.info('main').meeting, false);
});

test('a failed run finishes normally with its error kept; the next good run clears it (I8.6)', () => {
  const r = rig();
  r.ev('run.start', { runId: 'f1' }); r.ev('run.end', { runId: 'f1', status: 'error', error: 'The model refused' });
  assert.equal(r.pc.info('main').state, 'finishing'); assert.equal(r.pc.info('main').lastRunError, 'The model refused');
  r.tick(9000); assert.equal(r.pc.info('main').state, 'idle'); assert.equal(r.pc.info('main').lastRunError, 'The model refused', 'kept after it finished');
  r.ev('run.start', { runId: 'f2' }); r.ev('run.end', { runId: 'f2', status: 'stopped' });
  assert.equal(r.pc.info('main').lastRunError, null, 'stopped by the user is not an error');
  r.ev('run.start', { runId: 'f3' }); r.ev('run.end', { runId: 'f3', status: 'error' }); assert.equal(r.pc.info('main').lastRunError, 'The run failed');
  r.ev('run.start', { runId: 'f4' }); r.ev('run.end', { runId: 'f4', status: 'ok' }); assert.equal(r.pc.info('main').lastRunError, null);
});

test('a long quiet run stays working while it is inside the limit, and a silent one is finished, not left working forever (I8.6)', () => {
  const r = rig();
  r.ev('run.start', { runId: 'q1' });
  r.tick(59 * MIN); assert.equal(r.pc.info('main').state, 'working', 'quiet for 59 minutes is still a run');
  r.ev('run.progress', { runId: 'q1', text: 'still here' });
  r.tick(59 * MIN); assert.equal(r.pc.info('main').state, 'working', 'a sign of life resets the clock');
  r.tick(2 * MIN);
  assert.equal(r.pc.info('main').state, 'finishing'); assert.match(r.pc.info('main').lastRunError, /No activity for 60 minutes/);
  const end = r.seen.find(e => e.type === 'run.end' && e.runId === 'q1');
  assert.ok(end && end.status === 'interrupted' && end.connectionId === '7' && end.agentKey === 'main', 'the chat is told, so its session frees up');
  r.tick(9000); assert.equal(r.pc.info('main').state, 'idle');
  r.ev('run.progress', { runId: 'q1', text: 'late' }); assert.equal(r.pc.info('main').state, 'idle', 'a late event of a finished run is ignored');
  assert.equal(r.pc.status().activeRuns, 0);
});

test('the quiet limit and the finishing grace are read every time, so a change applies at once', () => {
  const r = rig();
  r.limits.graceMs = 1000; r.limits.quietMs = 30 * MIN;
  r.ev('run.start', { runId: 'l1' }); r.tick(31 * MIN); assert.match(r.pc.info('main').lastRunError, /No activity for 30 minutes/);
  r.tick(1001); assert.equal(r.pc.info('main').state, 'idle');
  assert.deepEqual([r.pc.status().finishGraceSec, r.pc.status().quietLimitMin], [1, 30]);
});

test('a helper crash or a provider restart interrupts the runs and nobody stays working; the agent works again after (C120, I8.6)', () => {
  const r = rig();
  r.ev('run.start', { runId: 'c1' });
  // what the host emits when the helper dies: each run interrupted, then the provider disconnected
  r.ev('run.end', { runId: 'c1', status: 'interrupted', error: 'The provider helper stopped (SIGKILL) and was restarted' });
  r.ev('provider.disconnected', { reason: 'The provider helper stopped' });
  assert.equal(r.pc.info('main').state, 'finishing'); assert.match(r.pc.info('main').lastRunError, /helper stopped/);
  r.tick(9000); assert.equal(r.pc.info('main').state, 'idle');
  // a disconnect that arrives with no run.end still ends the run
  r.ev('run.start', { runId: 'c2' }); r.ev('run.start', { runId: 'c3', agentKey: 'coder-native' });
  r.ev('provider.disconnected', { reason: 'The connection dropped' });
  assert.equal(r.pc.info('main').state, 'finishing'); assert.equal(r.pc.info('coder').state, 'finishing'); assert.equal(r.pc.info('main').lastRunError, 'The connection dropped');
  r.tick(9000); assert.deepEqual([r.pc.info('main').state, r.pc.info('coder').state], ['idle', 'idle']);
  r.ev('run.progress', { runId: 'c2', text: 'late' }); assert.equal(r.pc.info('main').state, 'idle', 'nothing replays');
  r.ev('run.start', { runId: 'c4' }); assert.equal(r.pc.info('main').state, 'working', 'and it works again after the restart');
  const other = rig(); other.ev('run.start', { runId: 'x' }); other.ev('provider.disconnected', { connectionId: '99', reason: 'someone else' });
  assert.equal(other.pc.info('main').state, 'working', 'another connection going away does not end this run');
});

test('an approval request shows the agent as waiting, and it works again when answered', () => {
  const r = rig();
  r.ev('run.start', { runId: 'p1' });
  r.ev('approval.requested', { runId: 'p1', approvalId: 'ap1', tool: 'shell', summary: 'rm -rf build' });
  assert.deepEqual([r.pc.info('main').state, r.pc.info('main').working], ['awaiting_approval', true]);
  r.ev('approval.resolved', { runId: 'p1', approvalId: 'ap1', approved: true }); assert.equal(r.pc.info('main').state, 'working');
  r.ev('run.end', { runId: 'p1', status: 'ok' });
  assert.deepEqual(r.changes.map(c => c[1]), ['working', 'awaiting_approval', 'working', 'finishing']);
});

test('overlapping runs keep the agent working until the last one ends; agents and connections never bleed into each other', () => {
  const r = rig();
  r.ev('run.start', { runId: 'o1' }); r.ev('run.start', { runId: 'o2' });
  r.ev('run.end', { runId: 'o1', status: 'ok' }); assert.equal(r.pc.info('main').state, 'working');
  r.ev('run.end', { runId: 'o2', status: 'ok' }); assert.equal(r.pc.info('main').state, 'finishing');
  r.ev('run.start', { runId: 'k1', agentKey: 'coder-native' });
  assert.deepEqual([r.pc.info('coder').state, r.pc.info('main').state], ['working', 'finishing'], 'the other agent is untouched');
  r.ev('run.start', { runId: 'z1', connectionId: '8' }); assert.equal(r.pc.info('solo'), null, 'an event for a connection no agent uses is ignored');
  r.ev('run.start', { runId: 'z2', agentKey: 'stranger' }); assert.equal(r.pc.status().activeRuns, 1);
});

test('a run whose start was missed is adopted, and a finished run is never resurrected', () => {
  const r = rig();
  r.ev('run.progress', { runId: 'm1', text: 'hello' }); assert.equal(r.pc.info('main').state, 'working');
  r.ev('run.end', { runId: 'm1', status: 'ok' }); r.tick(9000);
  r.ev('tool.end', { runId: 'm1', toolId: 't', ok: true }); assert.equal(r.pc.info('main').state, 'idle');
  r.ev('run.end', { runId: 'never-started', status: 'error', error: 'boom' }); assert.equal(r.pc.info('main').state, 'finishing', 'an end without a start still finishes normally');
  assert.equal(r.pc.info('main').lastRunError, 'boom');
});

test('a change handler that throws never stops the coordinator', () => {
  const r = rig();
  r.pc.onChange = () => { throw new Error('boom'); };
  r.ev('run.start', { runId: 'e1' }); assert.equal(r.pc.info('main').state, 'working');
  r.ev('run.end', { runId: 'e1', status: 'ok' }); r.tick(9000); assert.equal(r.pc.info('main').state, 'idle');
});

test('the first time an agent shows as idle it is reported (a connected agent signing in), the first time it shows as offline or unknown it is not', () => {
  const r = rig();
  r.pc.refresh('main');   // never seen before, and its connection works: idle
  assert.deepEqual(r.changes, [['main', 'idle', false]], 'open pages must learn that a connected agent came online');
  r.pc.refresh('main'); assert.equal(r.changes.length, 1, 'nothing new the second time');
  r.pc.refresh('solo');   // nothing to report on: offline is what pages assume, so no news
  r.conns[7].enabled = false; r.pc.refresh('coder');   // a switched-off connection: offline from the start
  assert.equal(r.changes.length, 1, 'a first sighting as offline is not news');
  r.conns[7].enabled = true; r.pc.refresh('coder');    // it comes up: that IS news
  assert.deepEqual(r.changes.at(-1), ['coder', 'idle', false]);
});

test('the server\'s own brain: every agent on it shares the platform id "mind", and a run names its agent by its key - that agent works, no other', () => {
  const r = rig();
  r.list.push({ id: 4, key: 'adam', enabled: true, connectionId: 7, nativeId: 'mind' }, { id: 5, key: 'team-acon', enabled: true, connectionId: 7, nativeId: 'mind' });
  r.ev('run.start', { runId: 'm1', agentKey: 'team-acon' });
  assert.deepEqual([r.pc.info('team-acon').state, r.pc.info('adam').state], ['working', 'idle'], 'an agent works; Adam, first with the same platform id, does not');
  r.ev('run.end', { runId: 'm1', agentKey: 'team-acon', status: 'ok' });
  assert.equal(r.pc.info('team-acon').state, 'finishing');
  // a platform that names its agents its own way still does
  r.ev('run.start', { runId: 'c1', agentKey: 'coder-native' });
  assert.equal(r.pc.info('coder').state, 'working');
});

test('an agent at work elsewhere (its provider says so: other channels, schedules) works, then finishes with the grace', () => {
  const r = rig();
  r.ev('agent.activity', { agentKey: 'coder-native', active: true, sessions: 1, task: 'Working on “Inbox”' });
  assert.deepEqual([r.pc.info('coder').state, r.pc.info('coder').working, r.pc.info('coder').task], ['working', true, 'Working on “Inbox”']);
  assert.equal(r.pc.info('main').state, 'idle', 'only that agent');
  // a run of this installation's at the same time: its own task first; when it ends the agent still works elsewhere
  r.ev('run.start', { runId: 'w1', agentKey: 'coder-native' }); r.ev('tool.start', { runId: 'w1', agentKey: 'coder-native', toolId: 't', name: 'exec' });
  assert.equal(r.pc.info('coder').task, 'Using exec');
  r.ev('run.end', { runId: 'w1', agentKey: 'coder-native', status: 'ok' });
  assert.equal(r.pc.info('coder').state, 'working', 'still at work elsewhere');
  r.ev('agent.activity', { agentKey: 'coder-native', active: false, sessions: 0 });
  assert.equal(r.pc.info('coder').state, 'finishing');
  r.tick(9000); assert.equal(r.pc.info('coder').state, 'idle');
  // the connection dropping ends it too
  r.ev('agent.activity', { agentKey: 'coder-native', active: true, sessions: 2 });
  r.ev('provider.disconnected', { reason: 'The connection dropped' });
  assert.equal(r.pc.info('coder').state, 'finishing');
  assert.ok(r.changes.some(([k, s, w]) => k === 'coder' && s === 'working' && w), 'its change of state was reported');
});
