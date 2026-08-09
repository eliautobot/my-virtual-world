#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/client/js/chat-events.js';
import { orderedSnapshotBubbleParts } from '../src/client/js/chat-bubble-events.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { TurnEventReducer, mergeHistoryItems, timestampMs, toolIdentity } = globalThis.ChatEvents;

const checks = [];
function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  checks.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${!ok && detail ? ` -- ${detail}` : ''}`);
}
const kinds = actions => actions.map(action => action.kind);
const feed = (reducer, events) => events.flatMap(event => reducer.ingest(event));

// Cumulative OpenClaw/GLM-style text freezes above a tool and resumes below.
{
  const reducer = new TurnEventReducer();
  feed(reducer, [
    { kind: 'run.start', runId: 'openclaw' },
    { kind: 'text.replace', runId: 'openclaw', text: 'I will inspect the file.' }
  ]);
  const toolStart = reducer.ingest({ kind: 'tool.start', runId: 'openclaw', tool: { id: 'read-1', name: 'read', arguments: { path: '/tmp/a' } } });
  check('Tool start freezes current commentary first', kinds(toolStart).join(',') === 'text.finalize,tool.start', kinds(toolStart).join(','));
  check('Frozen commentary retains exact text', toolStart[0]?.text === 'I will inspect the file.');
  reducer.ingest({ kind: 'tool.result', runId: 'openclaw', tool: { id: 'read-1', name: 'read', result: 'ok', status: 'done' } });
  const resumed = reducer.ingest({ kind: 'text.replace', runId: 'openclaw', text: 'I will inspect the file.\nThe file is valid.' });
  check('Cumulative text resumes as a suffix segment', resumed[0]?.kind === 'text.open' && resumed[0]?.text === '\nThe file is valid.', JSON.stringify(resumed));
  const terminal = reducer.ingest({ kind: 'run.complete', runId: 'openclaw' });
  check('Completion finalizes suffix before terminal', kinds(terminal).join(',') === 'text.finalize,run.terminal', kinds(terminal).join(','));
  check('Completed run records terminal state', reducer.get('openclaw')?.status === 'completed');
}

for (const provider of ['hermes', 'codex', 'claude-code']) {
  const reducer = new TurnEventReducer();
  reducer.ingest({ kind: 'text.delta', runId: provider, text: 'Checking' });
  reducer.ingest({ kind: 'tool.start', runId: provider, tool: { id: `${provider}-tool`, name: 'exec' } });
  reducer.ingest({ kind: 'tool.result', runId: provider, tool: { id: `${provider}-tool`, name: 'exec', result: 'done', status: 'done' } });
  const after = reducer.ingest({ kind: 'text.delta', runId: provider, text: 'Finished' });
  check(`${provider} delta resumes below tool`, after[0]?.kind === 'text.open' && after[0]?.text === 'Finished', JSON.stringify(after));
}

{
  const reducer = new TurnEventReducer();
  const commentary = reducer.ingest({ kind: 'commentary', runId: 'timed', text: 'Recovered progress', ts: 1786227688601 });
  check('Recovered commentary preserves its original timestamp', commentary.find(action => action.kind === 'text.finalize')?.ts === 1786227688601, JSON.stringify(commentary));
}

{
  const reducer = new TurnEventReducer();
  reducer.ingest({ kind: 'text.replace', runId: 'snapshot', text: 'Before tool' });
  reducer.ingest({ kind: 'tool.start', runId: 'snapshot', tool: { id: 't1', name: 'search' } });
  const after = reducer.ingest({ kind: 'text.replace', runId: 'snapshot', text: 'After tool' });
  check('Post-tool replacement restart preserves committed prefix', reducer.get('snapshot').fullText === 'Before toolAfter tool');
  check('Post-tool replacement opens only the new segment', after[0]?.text === 'After tool');
  const stale = reducer.ingest({ kind: 'text.replace', runId: 'snapshot', text: 'Before tool' });
  check('Stale shorter cumulative snapshots are ignored', stale[0]?.text !== 'Before tool');
}

{
  const reducer = new TurnEventReducer();
  reducer.ingest({ kind: 'text.replace', runId: 'fast', text: 'One moment.' });
  const actions = reducer.ingest({ kind: 'tool.result', runId: 'fast', tool: { id: 'instant', name: 'memory_get', result: 'found', status: 'done' } });
  check('Fast result synthesizes a tool start card', kinds(actions).join(',') === 'text.finalize,tool.start,tool.result', kinds(actions).join(','));
  check('Fast result preserves result payload', actions[2]?.tool?.result === 'found');
}

{
  const reducer = new TurnEventReducer();
  reducer.ingest({ kind: 'text.delta', runId: 'reasoning', text: 'Preface' });
  const thought = reducer.ingest({ kind: 'thinking', runId: 'reasoning', text: 'Evaluate constraints' });
  check('Thinking freezes prior text before its card', kinds(thought).join(',') === 'text.finalize,thinking', kinds(thought).join(','));
  reducer.ingest({ kind: 'tool.start', runId: 'reasoning', tool: { id: 'long', name: 'exec' } });
  const failed = reducer.ingest({ kind: 'run.failed', runId: 'reasoning', error: 'boom' });
  check('Failed run settles running tool before terminal', kinds(failed).join(',') === 'tool.result,run.terminal', kinds(failed).join(','));
  check('Failed running tool becomes error', failed[0]?.tool?.status === 'error' && failed[0]?.tool?.error === 'boom');
  check('Failed run records terminal state', failed[1]?.status === 'failed');
}

{
  const reducer = new TurnEventReducer();
  reducer.ingest({ kind: 'tool.start', runId: 'cancel', tool: { id: 'cmd', name: 'exec' } });
  const cancelled = reducer.ingest({ kind: 'run.cancelled', runId: 'cancel' });
  check('Cancelled tool settles instead of remaining running', cancelled[0]?.tool?.status === 'done' && cancelled[0]?.tool?.result === 'Cancelled');
  check('Cancelled run emits terminal cleanup', cancelled.at(-1)?.kind === 'run.terminal' && cancelled.at(-1)?.status === 'cancelled');
}

{
  const reducer = new TurnEventReducer();
  reducer.ingest({ kind: 'tool.result', runId: 'sdk', tool: { id: 'sdk-tool', name: 'bash', status: 'done', result: 'ok' } });
  const repeated = reducer.ingest({ kind: 'tool.result', runId: 'sdk', tool: { id: 'sdk-tool', name: 'bash', status: 'done', result: 'ok' } });
  const staleStart = reducer.ingest({ kind: 'tool.start', runId: 'sdk', tool: { id: 'sdk-tool', name: 'bash', status: 'running' } });
  check('Repeated SDK terminal snapshot emits nothing', repeated.length === 0, JSON.stringify(repeated));
  check('Stale SDK start cannot reopen settled tool', staleStart.length === 0 && reducer.get('sdk')?.tools.get('id:sdk-tool')?.status === 'done');
}

{
  const reducer = new TurnEventReducer();
  reducer.ingest({ kind: 'text.replace', runId: 'late', text: 'Partial ans' });
  reducer.ingest({ kind: 'run.complete', runId: 'late' });
  const late = reducer.ingest({ kind: 'text.replace', runId: 'late', text: 'Partial answer' });
  check('Late final amends finalized bubble in place', kinds(late).join(',') === 'text.amend' && late[0]?.text === 'Partial answer', JSON.stringify(late));
  check('Exact duplicate late final is a no-op', reducer.ingest({ kind: 'text.replace', runId: 'late', text: 'Partial answer' }).length === 0);
}

{
  const reducer = new TurnEventReducer();
  const commentary = reducer.ingest({ kind: 'commentary', runId: 'commentary', text: 'I will inspect the exact change set.' });
  check('Public commentary opens and finalizes one visible segment', kinds(commentary).join(',') === 'text.open,text.finalize', kinds(commentary).join(','));
  const tool = reducer.ingest({ kind: 'tool.start', runId: 'commentary', tool: { id: 'read-after-commentary', name: 'read' } });
  check('Tool follows commentary without duplication', kinds(tool).join(',') === 'tool.start', kinds(tool).join(','));
  const final = reducer.ingest({ kind: 'text.replace', runId: 'commentary', text: 'The file is valid.' });
  check('Final opens below commentary and tool', final[0]?.kind === 'text.open' && final[0]?.text === 'The file is valid.');
}

// Explicit task/TODO contract.
{
  const reducer = new TurnEventReducer();
  reducer.ingest({ kind: 'commentary', runId: 'todo', text: 'I will make a task plan.' });
  const start = reducer.ingest({ kind: 'tool.start', runId: 'todo', tool: { id: 'todo-1', name: 'todo', arguments: { todos: [{ id: 'a', status: 'pending' }] } } });
  const update = reducer.ingest({ kind: 'tool.update', runId: 'todo', tool: { id: 'todo-1', name: 'todo', arguments: { todos: [{ id: 'a', status: 'in_progress' }] } } });
  const result = reducer.ingest({ kind: 'tool.result', runId: 'todo', tool: { id: 'todo-1', name: 'todo', result: '1 completed', status: 'done' } });
  const suffix = reducer.ingest({ kind: 'text.replace', runId: 'todo', text: 'All tasks are complete.' });
  check('TODO starts as one chronological tool card', kinds(start).join(',') === 'tool.start');
  check('TODO update mutates the same card', kinds(update).join(',') === 'tool.update' && update[0]?.tool?.key === start[0]?.tool?.key);
  check('TODO result mutates the original card', kinds(result).join(',') === 'tool.result' && result[0]?.tool?.key === start[0]?.tool?.key);
  check('Final suffix opens below completed TODO', suffix[0]?.kind === 'text.open' && suffix[0]?.text === 'All tasks are complete.');
  const repeated = reducer.ingest({ kind: 'tool.result', runId: 'todo', tool: { id: 'todo-1', name: 'todo', result: '1 completed', status: 'done' } });
  check('Repeated done TODO snapshot is ignored', repeated.length === 0);
  const stale = reducer.ingest({ kind: 'tool.start', runId: 'todo', tool: { id: 'todo-1', name: 'todo', status: 'running' } });
  check('Stale TODO start after done is ignored', stale.length === 0);
}

{
  const reducer = new TurnEventReducer();
  const fast = reducer.ingest({ kind: 'tool.result', runId: 'fast-todo', tool: { id: 'todo-fast', name: 'todo', result: 'done', status: 'done' } });
  check('Fast TODO result synthesizes exactly one start and one result', kinds(fast).join(',') === 'tool.start,tool.result', kinds(fast).join(','));
}

{
  const base = 1_780_000_000_000;
  const merged = mergeHistoryItems([
    { role: 'assistant', text: 'Commentary', ts: base + 100, tools: [] },
    { role: 'assistant', text: 'Final', ts: base + 300, tools: [] },
    { role: 'assistant', text: '', ts: base + 200, tools: [{ id: 'tool-a', name: 'read', status: 'running' }] },
    { role: 'assistant', text: '', ts: base + 250, tools: [{ id: 'tool-a', name: 'read', status: 'done', result: 'ok' }] }
  ]);
  check('Recovered activity is inserted chronologically', merged.map(item => item.text || item.tools[0]?.name).join('|') === 'Commentary|read|Final', JSON.stringify(merged));
  check('Tool result pairs with original call card', merged[1]?.tools?.[0]?.status === 'done' && merged[1]?.tools?.[0]?.result === 'ok');
  check('Paired result does not create a duplicate card', merged.filter(item => item.tools?.length).length === 1);
  const stable = mergeHistoryItems([
    { role: 'user', text: 'one', ts: base, tools: [] },
    { role: 'assistant', text: 'two', ts: base, tools: [] },
    { role: 'assistant', text: 'three', ts: base, tools: [] }
  ]);
  check('Equal timestamps retain source order', stable.map(item => item.text).join(',') === 'one,two,three');
  check('ISO timestamps normalize to epoch milliseconds', timestampMs('2026-08-06T12:00:00Z') === Date.parse('2026-08-06T12:00:00Z'));
  check('Tool identity prefers stable call ids', toolIdentity({ id: 'abc', name: 'read' }) === 'id:abc');
  check('Tool identity falls back to run/name/preview', toolIdentity({ runId: 'r', name: 'read', arguments: { path: '/tmp/a' } }) === 'r|read|/tmp/a');
}

{
  const ordered = orderedSnapshotBubbleParts({
    commentary: 'I will inspect the file.',
    thinking: 'Check the constraints',
    tools: [{ id: 'read-1', name: 'read', status: 'done' }],
    text: 'The file is valid.'
  });
  check('Yellow-bubble snapshot keeps commentary, thinking, tool, then final', ordered.map(part => part.kind).join(',') === 'commentary,thinking,tool,text', JSON.stringify(ordered));
  const duplicateReasoning = orderedSnapshotBubbleParts({ thinking: 'Same answer', text: 'Same answer' });
  check('Yellow-bubble snapshot suppresses reasoning equal to visible final', duplicateReasoning.map(part => part.kind).join(',') === 'text', JSON.stringify(duplicateReasoning));
  const resultBeforeFinal = orderedSnapshotBubbleParts({ tools: [{ id: 'fast', name: 'read', status: 'done', result: 'ok' }], text: 'Done' });
  check('Yellow-bubble snapshot keeps a fast tool result above final text', resultBeforeFinal.map(part => part.kind).join(',') === 'tool,text', JSON.stringify(resultBeforeFinal));
}

{
  const root = path.resolve(__dirname, '..');
  const chat = fs.readFileSync(path.join(root, 'src/client/js/chat.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'src/client/index.html'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'src/server/server.py'), 'utf8');
  check('Native streams use one stream adapter', /streamNativeRunEvents\(provider, runId\)/.test(chat));
  check('Native events use one event adapter', /handleNativeRunEvent\(provider, eventName, data\)/.test(chat));
  check('Provider SDK stream enters shared reducer', /handleProviderSdkEvent\(eventName, data\)[\s\S]*applyTurnEvent/.test(chat));
  check('Provider terminal cleanup uses shared reducer', /handleProviderSdkEvent\(eventName, data\)[\s\S]*run\.completed[\s\S]*applyTurnEvent/.test(chat));
  check('OpenClaw chat events enter shared reducer', /handleChatEvent\(payload\)[\s\S]*applyTurnEvent/.test(chat));
  check('OpenClaw tool events enter shared reducer', /handleAgentEvent\(payload\)[\s\S]*tool\.result[\s\S]*applyTurnEvent/.test(chat));
  check('OpenClaw queue recovers safe commentary before boundaries', /queueOpenClawEvent\(eventName, payload\)[\s\S]*syncOpenClawCommentary/.test(chat));
  check('Live commentary requires matching verified run boundaries', /messageRunId !== expectedRunId/.test(chat) && /epochMs < runStartedAt/.test(chat));
  check('Live commentary renders with its recovered timestamp', /kind: 'commentary'[\s\S]*ts: epochMs/.test(chat) && /finalizeStreamingMessage\(text, undefined, runId, action\.ts/.test(chat));
  check('Duplicate reasoning is suppressed', /applyDistinctThinking\(runId, value\)[\s\S]*thinking === visibleText/.test(chat));
  check('History uses shared chronological reconciliation', /renderHistoryItems\(items\)[\s\S]*ChatEvents\.mergeHistoryItems/.test(chat));
  check('Mobile resize clears squeezed desktop secondary windows', /function enforceSingleWindowMobileLayout\(\)[\s\S]*setSecondaryPanelOpen\(slotNum, false\)/.test(chat) && /window\.addEventListener\('resize'[\s\S]*enforceSingleWindowMobileLayout\(\)/.test(chat));
  check('Provider history preserves native message boundaries', /Provider history is already in transcript order/.test(chat));
  check('Tool-result roles normalize as assistant activity', /function isToolResultRole/.test(chat) && /isToolResultRole\(rawRole\)/.test(chat));
  check('Terminal cleanup is centralized', /finishRunUi\(runId, status/.test(chat));
  check('Chat event model loads before renderer', index.indexOf('chat-events.js') > -1 && index.indexOf('chat-events.js') < index.indexOf('chat.js'));
  check('Server recovers only public Codex commentary', /payload\.get\("phase"\) != "commentary"/.test(server) && /commentary_only=/.test(server));
  check('Server scopes Codex commentary to trajectory run windows', /def _trajectory_run_windows/.test(server) && /window\["startMs"\] <= epoch_ms <= window\["endMs"\]/.test(server));
  check('Session activity endpoint supports commentaryOnly', /path == "\/api\/session-activity"/.test(server) && /commentaryOnly/.test(server));
  check('OpenClaw browser chat defaults to the same-origin proxy', /GATEWAY_TRANSPORT = 'proxy'/.test(chat) && /new EventSource\(GATEWAY_EVENTS_URL/.test(chat));
  check('OpenClaw proxy RPC uses same-origin credentials', /fetch\(GATEWAY_RPC_URL,[\s\S]*credentials: 'same-origin'/.test(chat));
  check('OpenClaw proxy accepts bounded long-session history responses', /_OPENCLAW_GATEWAY_RPC_MAX_BYTES = _env_int\([\s\S]*8 \* 1024 \* 1024/.test(server) && /max_size=_OPENCLAW_GATEWAY_RPC_MAX_BYTES/.test(server));
  check('Gateway operator token remains server-side in proxy mode', /if OPENCLAW_BROWSER_TRANSPORT == "direct":[\s\S]*payload\["token"\]/.test(server));
  check('OpenClaw proxy exposes only chat RPC methods', /_OPENCLAW_PROXY_METHODS = \{"sessions\.describe", "chat\.history", "chat\.send", "chat\.abort"\}/.test(server));
  check('OpenClaw proxy requires its HttpOnly same-origin cookie', /HttpOnly; SameSite=Strict/.test(server) && /_openclaw_proxy_same_origin/.test(server));
}

const failed = checks.filter(item => !item.ok);
if (failed.length) {
  console.error(`FAILED: ${failed.length}/${checks.length} chat architecture checks failed`);
  process.exit(1);
}
console.log(`verify-chat-event-architecture: OK (${checks.length} checks)`);
