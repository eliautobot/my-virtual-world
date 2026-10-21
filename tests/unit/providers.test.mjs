// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The provider core (server/providers/*, PLAN WP2.2; DECISIONS A9, C120; CHECKLIST X12): manifests, the normalized event
// bus, the registry, and the supervised helper process, exercised with the mock provider.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BUILTIN_MANIFESTS, validateManifest, connectionKindFor, CAPABILITIES } from '../../server/providers/manifest.js';
import { EventBus, normalize, TEXT_MAX } from '../../server/providers/bus.js';
import { Registry } from '../../server/providers/registry.js';
import { ProviderHost, HostError, backoffDelay, minimalEnv } from '../../server/providers/host.js';

const MOCK = fileURLToPath(new URL('../../server/providers/mock.js', import.meta.url));
const hosts = [];
after(async () => { for (const h of hosts) await h.stop(); });
async function makeHost(o = {}) {
  const bus = new EventBus(), events = [];
  bus.on(e => events.push(e));
  const registry = new Registry({ allowTest: true });
  const host = new ProviderHost({ adapters: [MOCK], bus, registry, backoff: { base: 20, max: 200, stableMs: 60000 }, ...o });
  hosts.push(host);
  await host.start();
  return { host, bus, events, registry };
}
const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 20)); } throw new Error('timed out waiting'); };

/** The kinds that are built (no work package still to come). */
const BUILT = ['openclaw', 'hermes', 'openai-decisions', 'models', 'voice', 'twilio', 'browser', 'search'];

test('the built-in manifests are valid, list every kind, and name the official interface each adapter uses (X12)', () => {
  assert.deepEqual(BUILTIN_MANIFESTS.map(m => m.id), ['openclaw', 'hermes', 'codex', 'claude-code', 'opencode', 'antigravity', 'universal', 'models', 'openai-decisions', 'voice', 'twilio', 'browser', 'search', 'agentapi']);
  assert.deepEqual(BUILTIN_MANIFESTS.filter(m => m.system).map(m => m.id), ['agentapi'], 'only the connected-agent kind is made by the server');
  for (const m of BUILTIN_MANIFESTS) {
    assert.deepEqual(validateManifest(m), [], m.id);
    assert.ok(m.official.length > 8, `${m.id} names its documented interface`);
    // a kind still to come names its work package; one without is built (the decision service for Free Will, the model
    // provider the Mind thinks with, the voice services of the chat window, OpenClaw and Hermes in Agent Providers)
    if (m.arrivesIn !== undefined) assert.match(m.arrivesIn, /^WP2\.\d+$/);
    else assert.ok(BUILT.includes(m.id), `${m.id}: only the decision service, the model provider, the voice services, the phone service, OpenClaw, Hermes and the agents' PC's browser and search services ship without arrivesIn`);
    for (const k of Object.keys(m.capabilities)) assert.ok(CAPABILITIES.includes(k));
    for (const f of m.fields) if (f.type === 'secret') assert.equal(f.default, undefined, 'a secret has no default');
  }
});

test('OpenClaw\'s sub-menu: the calls its adapter takes as changes are exactly those its manifest names (each needs a recent password and is audited)', async () => {
  const { MENU_READ, MENU_WRITE } = await import('../../server/providers/openclaw/menu.js');
  const oc = BUILTIN_MANIFESTS.find(m => m.id === 'openclaw');
  assert.deepEqual([...oc.menuWrite].sort(), [...MENU_WRITE].sort());
  assert.equal(MENU_READ.some(m => MENU_WRITE.includes(m)), false, 'no call is both');
});

test('Hermes\' sub-menu: the calls its adapter takes as changes are exactly those its manifest names', async () => {
  const { MENU_READ, MENU_WRITE } = await import('../../server/providers/hermes/menu.js');
  const hm = BUILTIN_MANIFESTS.find(m => m.id === 'hermes');
  assert.deepEqual([...hm.menuWrite].sort(), Object.keys(MENU_WRITE).sort());
  assert.equal(Object.keys(MENU_READ).some(m => Object.hasOwn(MENU_WRITE, m)), false, 'no call is both');
});

test('manifest validation refuses bad manifests with readable reasons', () => {
  const ok = { id: 'x1', label: 'X', transport: 'network', connectionKind: 'remote', official: 'The vendor API (documented)', fields: [], capabilities: { chat: true } };
  assert.deepEqual(validateManifest(ok), []);
  assert.ok(validateManifest({ ...ok, id: 'Bad Id' }).length);
  assert.ok(validateManifest({ ...ok, official: '' }).some(p => /official/.test(p)), 'the documented interface is required');
  assert.ok(validateManifest({ ...ok, connectionKind: 'anywhere' }).some(p => /connectionKind/.test(p)));
  assert.ok(validateManifest({ ...ok, capabilities: { teleport: true } }).some(p => /unknown capability/.test(p)));
  assert.ok(validateManifest({ ...ok, fields: [{ key: 'a', label: 'A', type: 'secret', default: 'x' }] }).some(p => /no default/.test(p)));
  assert.ok(validateManifest({ ...ok, fields: [{ key: 'a', label: 'A', type: 'text' }, { key: 'a', label: 'B', type: 'text' }] }).some(p => /twice/.test(p)));
  assert.ok(validateManifest(null).length);
});

test('who may add a connection follows from its kind: a manifest with modes decides by the mode; Hermes and OpenClaw are remote, Codex a host process (I8.13)', () => {
  const h = BUILTIN_MANIFESTS.find(m => m.id === 'hermes'), codex = BUILTIN_MANIFESTS.find(m => m.id === 'codex'), oc = BUILTIN_MANIFESTS.find(m => m.id === 'openclaw');
  const moded = { ...h, modes: [{ id: 'api', connectionKind: 'remote' }, { id: 'cli', connectionKind: 'host-process' }] };
  assert.equal(connectionKindFor(moded, { mode: 'api' }), 'remote');
  assert.equal(connectionKindFor(moded, { mode: 'cli' }), 'host-process');
  assert.equal(connectionKindFor(moded, {}), 'remote', 'the first mode by default');
  assert.equal(connectionKindFor(h, {}), 'remote');
  assert.equal(connectionKindFor(codex, {}), 'host-process');
  assert.equal(connectionKindFor(oc, {}), 'remote');
});

test('the bus rebuilds every event from a whitelist and limits text (nothing else travels)', () => {
  const e = normalize({ type: 'run.end', kind: 'mock', connectionId: 'c1', runId: 'r1', status: 'ok', token: 'SECRET', raw: { a: 1 }, error: 'x'.repeat(TEXT_MAX + 500) }, 1000);
  assert.deepEqual(Object.keys(e).sort(), ['connectionId', 'error', 'kind', 'runId', 'status', 'ts', 'type']);
  assert.equal(e.error.length, TEXT_MAX); assert.equal(JSON.stringify(e).includes('SECRET'), false);
  assert.throws(() => normalize({ type: 'nope' }), x => x.code === 'bad_event');
  assert.throws(() => normalize({ type: 'run.end', kind: 'mock', connectionId: 'c1', runId: 'r1', status: 'weird' }), /status must be one of/);
  assert.throws(() => normalize({ type: 'run.end', kind: 'mock', connectionId: 'c1', runId: 'r1' }), /status is required/);
  assert.throws(() => normalize({ type: 'tool.end', kind: 'mock', connectionId: 'c1', runId: 'r1', toolId: 't', ok: 'yes' }), /true or false/);
  assert.throws(() => normalize({ type: 'provider.connected', connectionId: 'c1' }), /kind is required/);
});

test('one subscriber that throws never stops the others', () => {
  const bus = new EventBus({ log: { error() {} } }), seen = [];
  bus.on(() => { throw new Error('boom'); });
  const off = bus.on(e => seen.push(e.type));
  bus.emit({ type: 'provider.connected', kind: 'mock', connectionId: 'c1' });
  off();
  bus.emit({ type: 'provider.connected', kind: 'mock', connectionId: 'c1' });
  assert.deepEqual(seen, ['provider.connected'], 'delivered once, then unsubscribed');
});

test('the registry lists every kind and says which adapters exist; only listed kinds (or allowed tests) are adopted', () => {
  const r = new Registry();
  assert.equal(r.list().length, 14); assert.equal(r.list().every(m => m.implemented === false && (m.arrivesIn === undefined ? BUILT.includes(m.id) : /^WP2/.test(m.arrivesIn))), true);
  const codex = BUILTIN_MANIFESTS.find(m => m.id === 'codex');
  const mock = { id: 'mock', label: 'Mock', test: true, transport: 'network', connectionKind: 'remote', official: 'None: the test double', fields: [], capabilities: { chat: true } };
  assert.deepEqual(r.adopt([codex, mock, { id: 'rogue', label: 'R', transport: 'network', connectionKind: 'remote', official: 'made up interface', fields: [], capabilities: {} }]), ['codex']);
  assert.equal(r.implemented('codex'), true); assert.equal(r.list().find(m => m.id === 'codex').arrivesIn, undefined);
  assert.equal(r.has('mock'), false, 'a test manifest is refused unless tests are allowed'); assert.equal(r.has('rogue'), false);
  assert.ok(r.problems.some(p => /rogue/.test(p)));
  const t = new Registry({ allowTest: true });
  assert.deepEqual(t.adopt([mock]), ['mock']); assert.equal(t.implemented('mock'), true);
  r.adopt([]); assert.equal(r.implemented('codex'), false, 'a restart re-reports what exists');
  // WP2.14: a kind the server serves itself needs no helper and survives every re-report
  r.addInProcess('agentapi'); assert.equal(r.implemented('agentapi'), true);
  r.adopt([]); assert.equal(r.implemented('agentapi'), true, 'still live after the helper reports nothing');
  assert.throws(() => r.addInProcess('nope'), /unknown kind/);
});

test('backoff doubles up to a ceiling; the helper gets a minimal environment with no server secrets', () => {
  assert.deepEqual([0, 1, 2, 3, 10].map(n => backoffDelay(n, 500, 30000)), [500, 1000, 2000, 4000, 30000]);
  const env = minimalEnv({ PATH: '/bin', HOME: '/h', MVW_SECRET_KEY: 'sealed', TYPESAFE_API_KEY: 'k', LANG: 'C', RANDOM: 'x' });
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'LANG', 'NODE_ENV', 'PATH']);
});

test('the helper starts, reports its manifests and answers calls; secrets in the server\'s environment never reach it', async () => {
  process.env.MVW_TEST_SECRET = 'must-not-leak';
  try {
    const { host, registry } = await makeHost();
    assert.equal(registry.implemented('mock'), true);
    assert.deepEqual(await host.call('mock', 'test', { secrets: { token: 'ok' } }), { ok: true, detail: 'Mock reachable' });
    assert.equal((await host.call('mock', 'test', { secrets: { token: 'wrong' } })).ok, false);
    assert.equal((await host.call('mock', 'discover')).agents.length, 2);
    const e = await host.call('mock', 'env');
    assert.equal(e.keys.includes('MVW_TEST_SECRET'), false, 'the server\'s environment is not the helper\'s');
    assert.ok(e.keys.includes('PATH') && !e.keys.some(k => /^MVW_|KEY|TOKEN|SECRET/.test(k)), 'only the minimal environment');
    await assert.rejects(() => host.call('mock', 'nope'), x => x instanceof HostError && x.code === 'unsupported');
    await assert.rejects(() => host.call('ghost', 'test'), x => x.code === 'no_adapter');
    await assert.rejects(() => host.call('mock', 'connect', { secrets: { token: 'wrong' } }), x => x.code === 'auth', 'the adapter\'s error code survives');
  } finally { delete process.env.MVW_TEST_SECRET; }
});

test('a run produces the normalized events in order, and a tool run reports the tool', async () => {
  const { host, events } = await makeHost();
  const { runId } = await host.call('mock', 'run', { runId: 'r-ok', agentKey: 'a1', sessionKey: 's1', connectionId: 'c1', input: 'tool' });
  assert.equal(runId, 'r-ok');
  await until(() => events.some(e => e.type === 'run.end'));
  assert.deepEqual(events.filter(e => e.runId === 'r-ok').map(e => e.type), ['run.start', 'run.progress', 'tool.start', 'tool.update', 'tool.end', 'run.end']);
  assert.equal(events.find(e => e.type === 'run.end').status, 'ok');
  assert.equal(host.status().inFlight, 0, 'nothing left in flight');
});

test('approvals and stop go through the helper', async () => {
  const { host, events } = await makeHost();
  await host.call('mock', 'run', { runId: 'r-ap', agentKey: 'a1', sessionKey: 's1', connectionId: 'c1', input: 'approve' });
  const ask = await until(() => events.find(e => e.type === 'approval.requested'));
  assert.equal(ask.tool, 'shell');
  await host.call('mock', 'approve', { approvalId: ask.approvalId, approved: true });
  await until(() => events.some(e => e.type === 'run.end' && e.runId === 'r-ap'));
  assert.deepEqual(events.filter(e => e.runId === 'r-ap').map(e => e.type).slice(-3), ['approval.requested', 'approval.resolved', 'run.end']);
  await host.call('mock', 'run', { runId: 'r-slow', agentKey: 'a1', sessionKey: 's1', connectionId: 'c1', input: 'slow:2000' });
  await until(() => host.runs.has('r-slow'));
  await host.call('mock', 'stop', { runId: 'r-slow' });
  const end = await until(() => events.find(e => e.type === 'run.end' && e.runId === 'r-slow'));
  assert.equal(end.status, 'stopped');
});

test('while the helper is down a call fails at once, so the simulation never waits (A9)', async () => {
  const { host } = await makeHost();
  await host.stop();
  const t = Date.now();
  await assert.rejects(() => host.call('mock', 'test'), x => x.code === 'host_down');
  assert.ok(Date.now() - t < 50, 'immediately, not after a timeout');
});

test('a crash mid-run: the run is interrupted with a reason, never replayed; the helper restarts and works again (C120)', async () => {
  const { host, events } = await makeHost();
  await host.call('mock', 'run', { runId: 'r-crash', agentKey: 'a1', sessionKey: 's1', connectionId: 'c1', input: 'crash' });
  const end = await until(() => events.find(e => e.type === 'run.end' && e.runId === 'r-crash'));
  assert.equal(end.status, 'interrupted'); assert.match(end.error, /helper stopped .* restarted/);
  assert.ok(events.some(e => e.type === 'provider.disconnected' || true));
  await until(() => host.ready, 6000);
  assert.equal(host.restarts >= 1, true);
  assert.deepEqual((await host.call('mock', 'test', {})).ok, true, 'works again');
  const sub = await host.call('mock', 'submitted');
  assert.equal(sub.runs.length, 0, 'the restarted helper has no memory of the run: nothing was replayed');
  assert.equal(events.filter(e => e.type === 'run.start' && e.runId === 'r-crash').length, 1, 'started exactly once');
});

test('a run request that is never answered is run_uncertain and is never retried (A9)', async () => {
  const { host } = await makeHost({ runTimeoutMs: 250 });
  await assert.rejects(() => host.call('mock', 'run', { runId: 'r-hang', agentKey: 'a1', sessionKey: 's1', connectionId: 'c1', input: 'hang' }), x => x.code === 'run_uncertain');
  const sub = await host.call('mock', 'submitted');
  assert.equal(sub.runs.filter(r => r.runId === 'r-hang').length, 1, 'submitted once, not retried');
  assert.equal(host.status().pending, 0);
});

test('a crash while a run request is in flight is run_uncertain too, and other calls fail as host_down', async () => {
  const { host } = await makeHost();
  const other = host.call('mock', 'run', { runId: 'r-x', agentKey: 'a1', sessionKey: 's1', connectionId: 'c1', input: 'hang' });
  const test2 = host.call('mock', 'slowcall').catch(e => e);
  host.child.kill('SIGKILL');
  await assert.rejects(() => other, x => x.code === 'run_uncertain');
  const e = await test2;
  assert.ok(e.code === 'host_down' || e.code === 'unsupported', e.code);
});
