// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An Agent Providers' agent's screens follow its provider's events (server/pc/provider-screens.js): a step shows in the
// app its kind belongs to, with what it works on; a run's later events (naming only the run) are its agent's; an agent made
// here, a talk in the city and an unrelated event change nothing; updates come at most every 400 ms, the last one kept.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderScreens } from '../../server/pc/provider-screens.js';

function rig() {
  const agents = new Map([[1, { id: 1, key: 'prov-3-main', connectionId: 3, nativeId: 'main' }], [2, { id: 2, key: 'agent-abc', connectionId: null }]]);
  const shown = [];
  let now = 1000, handler = null;
  const pc = { agents: { get: id => agents.get(id) }, screen: (agent, app, title, detail = '') => shown.push({ agent, app, title, detail }) };
  const agentOf = e => [...agents.values()].find(a => String(a.connectionId) === String(e.connectionId) && (a.nativeId === e.agentKey || a.key === e.agentKey)) || null;
  const ps = new ProviderScreens({ pc, agentOf, quiet: id => id === 'talk-1', now: () => now }).start({ on: fn => { handler = fn; return () => { handler = null; }; } });
  return { ps, shown, emit: e => handler(e), tick: ms => { now += ms; }, agents };
}

test('a step shows in its app; the run\'s later events are its agent\'s', async () => {
  const r = rig();
  r.emit({ type: 'run.start', kind: 'openclaw', connectionId: '3', agentKey: 'main', runId: 'r1' });
  assert.deepEqual(r.shown.at(-1), { agent: 1, app: 'chat', title: 'Working on a message', detail: '' });
  r.tick(500);
  r.emit({ type: 'tool.start', kind: 'openclaw', connectionId: '3', runId: 'r1', toolId: 't1', name: 'exec', title: 'Run npm test', input: 'npm test', toolKind: 'execute' });
  assert.deepEqual(r.shown.at(-1), { agent: 1, app: 'terminal', title: 'Run npm test', detail: 'npm test' });
  r.tick(500);
  r.emit({ type: 'tool.start', kind: 'openclaw', connectionId: '3', runId: 'r1', toolId: 't2', name: 'browser', title: 'Open example.com', toolKind: 'other' });
  assert.equal(r.shown.at(-1).app, 'browser', 'its browser tool, whatever kind the provider gives it');
  r.tick(500);
  r.emit({ type: 'tool.start', kind: 'openclaw', connectionId: '3', runId: 'r1', toolId: 't3', name: 'read', title: 'Read README.md', toolKind: 'read' });
  assert.equal(r.shown.at(-1).app, 'files');
  r.emit({ type: 'run.end', kind: 'openclaw', connectionId: '3', runId: 'r1', status: 'ok' });
  const n = r.shown.length;
  r.tick(500);
  r.emit({ type: 'tool.start', kind: 'openclaw', connectionId: '3', runId: 'r1', toolId: 't4', name: 'read', toolKind: 'read' });
  assert.equal(r.shown.length, n, 'a run that ended names nobody any more');
  r.ps.stop();
});

test('what its provider says it is busy with elsewhere; nothing for agents made here, talks, or other events', () => {
  const r = rig();
  r.emit({ type: 'agent.activity', kind: 'hermes', connectionId: '3', agentKey: 'main', active: true, task: 'Daily digest (scheduled)' });
  assert.deepEqual(r.shown.at(-1), { agent: 1, app: 'other', title: 'Daily digest (scheduled)', detail: '' });
  const n = r.shown.length;
  r.tick(500);
  r.emit({ type: 'agent.activity', kind: 'hermes', connectionId: '3', agentKey: 'main', active: false });
  r.emit({ type: 'run.start', kind: 'models', connectionId: '9', agentKey: 'agent-abc', runId: 'm1' });
  r.emit({ type: 'run.start', kind: 'openclaw', connectionId: '3', agentKey: 'main', runId: 'talk-1' });
  r.emit({ type: 'usage.update', kind: 'openclaw', connectionId: '3', agentKey: 'main', runId: 'r9', used: 5 });
  r.emit({ type: 'provider.status', kind: 'openclaw', connectionId: '3', state: 'connected' });
  assert.equal(r.shown.length, n);
  r.ps.stop();
});

test('at most one update every 400 ms: the last one waits its turn', async () => {
  const r = rig();
  r.emit({ type: 'run.start', kind: 'openclaw', connectionId: '3', agentKey: 'main', runId: 'r2' });
  for (let k = 0; k < 20; k++) r.emit({ type: 'run.progress', kind: 'openclaw', connectionId: '3', runId: 'r2', text: `step ${k}` });
  assert.equal(r.shown.length, 1, 'the burst waits');
  r.tick(400);
  await new Promise(res => setTimeout(res, 450));
  assert.equal(r.shown.length, 2);
  assert.equal(r.shown.at(-1).title, 'step 19', 'only the last of the burst');
  r.ps.stop();
});
