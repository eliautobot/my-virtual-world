#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/client/js/openclaw-run-state.js', import.meta.url), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'openclaw-run-state.js' });

const {
  OpenClawRunTracker,
  classifyAgentEvent,
  classifyChatEvent,
  classifyFailureStatus,
  isHistoricalToolError
} = sandbox.VirtualWorldOpenClawRunState;

const recoverableRunId = 'run-recoverable-tool-error';
const tracker = new OpenClawRunTracker();
const ambiguousLifecycleError = {
  runId: recoverableRunId,
  stream: 'lifecycle',
  data: { phase: 'error', message: 'A command returned a non-zero exit code' }
};
assert.equal(classifyAgentEvent(ambiguousLifecycleError), 'pending-error');
tracker.notePending(ambiguousLifecycleError);
assert.equal(tracker.pendingErrors.has(recoverableRunId), true);

const successfulFinal = {
  runId: recoverableRunId,
  state: 'final',
  message: { content: [{ type: 'text', text: 'Task completed after recovery.' }] }
};
assert.equal(classifyChatEvent(successfulFinal), 'success');
tracker.clear(successfulFinal);
assert.equal(tracker.pendingErrors.has(recoverableRunId), false);

assert.equal(
  classifyAgentEvent({
    runId: recoverableRunId,
    stream: 'tool',
    data: { phase: 'result', name: 'exec', isError: true, result: 'exit code 1' }
  }),
  'tool'
);
assert.equal(
  classifyAgentEvent({ runId: recoverableRunId, type: 'run.failed' }),
  'pending-error',
  'agent run.failed events can be emitted for recoverable command failures'
);
assert.equal(classifyChatEvent({ runId: 'run-provider-failure', state: 'error' }), 'terminal-error');

tracker.notePending({ runId: 'run-provider-failure', type: 'error', error: 'invalid API key' });
assert.match(
  classifyFailureStatus('authentication_error: invalid API key', { data: { provider: 'anthropic' } }),
  /^Model\/provider error$/
);
assert.equal(
  classifyFailureStatus('WebSocket connection timed out', { type: 'gateway_error' }),
  'OpenClaw error'
);
assert.equal(classifyFailureStatus('The run was cancelled by the user'), 'Run failed');
assert.equal(isHistoricalToolError({ type: 'toolResult', isError: true, content: 'exit code 1' }), true);
assert.equal(
  isHistoricalToolError(
    { type: 'toolResult', content: 'exit code 1' },
    { role: 'toolResult', isError: true }
  ),
  true,
  'OpenClaw stores isError on the parent toolResult message'
);
assert.equal(isHistoricalToolError({ type: 'toolResult', isError: false, content: 'ok' }), false);

const consumed = tracker.consumePending('run-provider-failure');
assert.equal(consumed.error, 'invalid API key');
assert.equal(tracker.consumePending('run-provider-failure'), null, 'duplicate terminal events must not reuse a pending error');
assert.equal(tracker.markFailed('run-provider-failure'), true);
assert.equal(tracker.markFailed('run-provider-failure'), false, 'duplicate terminal failures must be ignored');

tracker.markSucceeded(recoverableRunId);
assert.equal(tracker.isSucceeded(recoverableRunId), true);
assert.equal(
  tracker.markFailed(recoverableRunId),
  false,
  'a late tool-derived failure must not override an authoritative successful final'
);

tracker.markFailed('run-error-before-final');
tracker.markSucceeded('run-error-before-final');
assert.equal(
  tracker.isSucceeded('run-error-before-final'),
  true,
  'a later successful final must recover an earlier provisional run failure'
);

console.log('PASS: OpenClaw chat run-event regression scenarios verified.');
