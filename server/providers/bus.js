// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The normalized provider event bus (PLAN WP2.2; DECISIONS A8; the one lifecycle every provider feeds).
// Every adapter, whatever it talks to, reports the same few events. Each event is rebuilt from a whitelist, so nothing a
// provider sends beyond the listed fields (tokens, raw payloads) can travel further, and text is length-limited.
import { nativeOp as nativeHermes, nativeCall as callHermes, nativeResult as resultHermes } from './hermes/native.js';

export const TEXT_MAX = 4000;
export const ANSWER_MAX = 100000;   // a whole answer (run.end's text): a long reply with code is far more than TEXT_MAX
const SHORT_MAX = 200;

// A trailing '!' = required. s short string, t text, T a whole answer, n number, b boolean, e:a|b|c one of, l a short
// list of short strings (the choices an approval offers); Q an agent's questions, A their answers, P a plan's steps, K a
// background task, W a browser tab a step left (its id, address and title), S the provider's session keys (each rebuilt
// field by field, below).
const COMMON = { kind: 's!', connectionId: 's!', agentKey: 's', sessionKey: 's' };
export const EVENT_SPEC = Object.freeze({
  'provider.connected': {},
  'provider.disconnected': { reason: 't' },
  // an agent of the provider working or not, whatever started it (its other channels, its schedules): live presence
  // (waiting: those of its sessions waiting for the person — an approval, a question)
  'agent.activity': { agentKey: 's!', active: 'b!', sessions: 'n', task: 't', keys: 'S', waiting: 'S' },
  // a session's progress card changed with no run of this installation's there (a refresh, another channel, a job)
  'session.card': { sessionKey: 's!', steps: 'P', markdown: 'T', revision: 'n', updatedAt: 'n' },
  // a background task started from a session someone has open (a subagent, a scheduled job): changed, gone, or all of
  // them to be read again (the provider's task list was restored); here: the task is that chat's (else: its agent's, elsewhere)
  'session.task': { sessionKey: 's!', change: 'e:upserted|deleted|restored!', task: 'K', taskId: 's', here: 'b' },
  // a live connection's state (Agent Providers): connecting, connected, pairing (waiting for the provider's owner to approve
  // this device: requestId), error (what a person must fix: fix), offline (it will try again by itself). version: the
  // provider's; code: the provider's reason, for the pages to act on.
  'provider.status': { state: 'e:connecting|connected|pairing|error|offline!', detail: 't', fix: 't', requestId: 's', version: 's', code: 's' },
  'run.start': { runId: 's!', agentKey: 's!' },
  'run.progress': { runId: 's!', text: 't', pct: 'n' },
  // what the run is doing before (or between) its words, in the person's words: "Reading the conversation" (Agent Providers)
  'run.status': { runId: 's!', phase: 't' },
  // the answer as it is written (a piece of it; the client joins them) and, where the model shows it, its reasoning;
  // replace: the provider rewrote the answer so far — text is the whole of it
  'run.delta': { runId: 's!', text: 't', thinking: 't', replace: 'b' },
  // … and what it took, where the adapter knows (model, effort, tokens, cost in millionths of a US$, ms, the reasoning
  // shown) and a short title for a new chat
  'run.end': { runId: 's!', status: 'e:ok|error|stopped|interrupted!', error: 't', text: 'T', model: 's', effort: 's', tokensIn: 'n', tokensOut: 'n', cost: 'n', ms: 'n', thinking: 'T', title: 's', media: 'M', steered: 'b' },
  // one step (a tool call), following the Agent Client Protocol's tool calls: its title and kind (the icon), its input (a
  // command, a path), its output as it comes (update text: a piece; replace: the whole so far), how it ended (exit code,
  // time, the folder it ran in). (The event's own kind is the provider's: a step's is toolKind, an approval's approvalKind.)
  // (raw: its arguments whole, as JSON — what its PC's screens read to see what it works on: server/pc/recognize.js)
  'tool.start': { runId: 's!', toolId: 's!', name: 's!', input: 't', title: 't', toolKind: 'e:read|edit|delete|move|search|execute|think|fetch|other', raw: 't' },
  'tool.update': { runId: 's!', toolId: 's!', text: 't', input: 't', status: 's', replace: 'b', raw: 't' },
  'tool.end': { runId: 's!', toolId: 's!', ok: 'b', text: 't', name: 's', title: 't', status: 's', exitCode: 'n', ms: 'n', cwd: 't', tab: 'W' },
  // a step that waits for the person: what it is (kind, title, the command and where it would run, why it asks) and the
  // answers it takes (options: allow-once, allow-session, allow-always, deny); resolved with the answer given
  'approval.requested': { runId: 's!', approvalId: 's!', tool: 's', summary: 't', approvalKind: 's', title: 't', command: 't', cwd: 't', options: 'l', expiresAt: 'n' },
  'approval.resolved': { runId: 's!', approvalId: 's!', approved: 'b!', decision: 's' },
  // the context meter: tokens in the conversation now, of the model's window; cost in millionths of a US$
  'usage.update': { runId: 's', used: 'n', size: 'n', cost: 'n' },
  // the agent asks the person (up to 5 questions, each with its options; multiSelect, a free answer — other — or a
  // secret one); resolved: answered, cancelled or expired, with the answers (never a secret one's)
  'question.requested': { runId: 's!', questionId: 's!', questions: 'Q!', expiresAt: 'n' },
  'question.resolved': { runId: 's!', questionId: 's!', status: 's', answers: 'A' },
  // the run's plan (OpenClaw's progress card): its steps and how each stands, a line on where it is, its notes
  'plan.update': { runId: 's', title: 't', explanation: 't', steps: 'P', markdown: 'T', revision: 'n', updatedAt: 'n' },
  // a provider's own stream for its chat view (beside the events above: the turn laid out as its own app lays it out),
  // one operation at a time, rebuilt by that provider's own whitelist (NATIVE below)
  'native': { runId: 's!', ev: 'N!' },
  // … and one of a session's own, outside any turn (Hermes: a side question or a background task the chat started,
  // answered) — to whoever started it and whoever has that session open
  'session.native': { sessionKey: 's!', ev: 'N!' },
});
/** Each provider's whitelist for its own stream ('native'): kind → (operation) => the rebuilt operation, or null. */
const NATIVE = { hermes: nativeHermes };
/** … and its own calls for its view (Hermes: its slash commands, completions, side questions): kind → { call: (method,
 *  params) => { method, params, session, timeoutMs } or null, result: (method, answer) => the rebuilt answer }. */
export const NATIVE_CALLS = Object.freeze({ hermes: { call: callHermes, result: resultHermes } });
export const EVENT_TYPES = Object.freeze(Object.keys(EVENT_SPEC));

export class BusError extends Error {
  constructor(message) { super(message); this.code = 'bad_event'; }
}

function coerce(name, spec, v) {
  const req = spec.endsWith('!');
  const t = req ? spec.slice(0, -1) : spec;
  if (v === undefined || v === null) { if (req) throw new BusError(`${name} is required`); return undefined; }
  if (t === 's') { if (typeof v !== 'string' || !v) throw new BusError(`${name} must be a non-empty string`); return v.slice(0, SHORT_MAX); }
  if (t === 't') return String(v).slice(0, TEXT_MAX);
  if (t === 'T') return String(v).slice(0, ANSWER_MAX);
  if (t === 'n') { if (typeof v !== 'number' || !Number.isFinite(v)) throw new BusError(`${name} must be a number`); return v; }
  if (t === 'b') { if (typeof v !== 'boolean') throw new BusError(`${name} must be true or false`); return v; }
  if (t.startsWith('e:')) { if (!t.slice(2).split('|').includes(v)) throw new BusError(`${name} must be one of ${t.slice(2)}`); return v; }
  if (t === 'Q') return questions(name, v);
  if (t === 'M') return media(name, v);
  if (t === 'K') return task(name, v);
  if (t === 'S') {
    if (!Array.isArray(v)) throw new BusError(`${name} must be a list of session keys`);
    return v.filter(x => typeof x === 'string' && x).slice(0, 200).map(x => x.slice(0, 300));
  }
  if (t === 'W') {
    if (!v || typeof v.targetId !== 'string' || !/^[\w-]{1,128}$/.test(v.targetId) || typeof v.url !== 'string' || !/^https?:/i.test(v.url)) throw new BusError(`${name} must be a browser tab`);
    return { targetId: v.targetId, url: v.url.slice(0, 2048), ...(typeof v.title === 'string' && v.title ? { title: v.title.slice(0, 300) } : {}) };
  }
  if (t === 'A') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new BusError(`${name} must be answers`);
    return Object.fromEntries(Object.entries(v).slice(0, 5).map(([k, a]) => [String(k).slice(0, 80), (Array.isArray(a) ? a : [a]).slice(0, 8).map(x => String(x).slice(0, 500))]));
  }
  if (t === 'P') {
    if (!Array.isArray(v)) throw new BusError(`${name} must be a list of steps`);
    return v.slice(0, 50).filter(x => x && typeof x.step === 'string').map(x => ({ step: x.step.slice(0, 300), status: ['pending', 'in_progress', 'completed'].includes(x.status) ? x.status : 'pending' }));
  }
  if (t === 'l') {
    if (!Array.isArray(v) || v.length > 8 || !v.every(x => typeof x === 'string' && x && x.length <= 40)) throw new BusError(`${name} must be a short list of short strings`);
    return v.slice();
  }
  throw new BusError(`${name}: unknown spec`);
}

/** An agent's questions, rebuilt field by field (OpenClaw's question shape — Hermes' clarify asks up to five: an id, a short header, the question, up to
 *  four options with a description each, and whether several may be chosen, a free answer given, or it is a secret). */
function questions(name, v) {
  if (!Array.isArray(v) || !v.length || v.length > 5) throw new BusError(`${name} must be one to five questions`);
  return v.map(q => {
    if (!q || typeof q.questionId !== 'string' || !q.questionId || typeof q.question !== 'string') throw new BusError(`${name}: a question needs an id and its words`);
    return { questionId: q.questionId.slice(0, 80), header: String(q.header || '').slice(0, 40), question: q.question.slice(0, 1000),
      options: (Array.isArray(q.options) ? q.options : []).slice(0, 8).filter(o => o && typeof o.label === 'string' && o.label).map(o => ({ label: o.label.slice(0, 200), ...(o.description ? { description: String(o.description).slice(0, 500) } : {}) })),
      multiSelect: q.multiSelect === true, other: q.isOther === true || q.other === true, secret: q.isSecret === true || q.secret === true };
  });
}

/** What an answer carries (images, video, audio, files), rebuilt field by field: a kind, a name, its type and size, and
 *  the provider's own reference to it (an artifact id or the path or address the agent gave) — never its content. */
export function media(name, v) {
  if (!Array.isArray(v)) throw new BusError(`${name} must be a list of media`);
  return v.slice(0, 24).filter(m => m && m.ref && (typeof m.ref.artifactId === 'string' || typeof m.ref.source === 'string')).map(m => ({
    kind: ['image', 'video', 'audio', 'file'].includes(m.kind) ? m.kind : 'file', name: String(m.name || 'attachment').slice(0, 200),
    ...(typeof m.mime === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(m.mime) ? { mime: m.mime.slice(0, 100) } : {}),
    ...(Number.isFinite(m.w) ? { w: Math.round(m.w) } : {}), ...(Number.isFinite(m.h) ? { h: Math.round(m.h) } : {}), ...(Number.isFinite(m.size) ? { size: Math.round(m.size) } : {}),
    ref: typeof m.ref.artifactId === 'string' ? { artifactId: m.ref.artifactId.slice(0, 200) } : { source: m.ref.source.slice(0, 2048) } }));
}

export const TASK_STATUS = Object.freeze(['queued', 'running', 'completed', 'failed', 'cancelled', 'timed_out']);
const WAIT_KINDS = ['children', 'external', 'agent_messages', 'approval', 'user_input'];
const DELIVERY = ['pending', 'delivered', 'session_queued', 'failed', 'dismissed', 'parent_missing', 'not_applicable'];
const when = v => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : undefined);
/** A background task (OpenClaw's task ledger: a subagent, a scheduled job, a CLI or ACP run), rebuilt field by field:
 *  what it is, how it stands, what it is doing or waiting for, and how it ended — its prompt and result only when asked
 *  for one task. Never the provider's session keys. */
export function task(name, v) {
  if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !v.id || !TASK_STATUS.includes(v.status)) throw new BusError(`${name} must be a task`);
  const x = v.execution && typeof v.execution === 'object' ? v.execution : null;
  const ex = x && ['queued', 'running', 'waiting', 'finished', 'unknown'].includes(x.state) ? { state: x.state,
    ...(x.currentTool && typeof x.currentTool.name === 'string' ? { tool: { name: x.currentTool.name.slice(0, 80), ...(when(x.currentTool.startedAt) ? { since: when(x.currentTool.startedAt) } : {}) } } : {}),
    ...(when(x.lastActivityAt) ? { lastActivityAt: when(x.lastActivityAt) } : {}),
    ...(x.wait && WAIT_KINDS.includes(x.wait.kind) ? { wait: { kind: x.wait.kind, ...(Number.isInteger(x.wait.pendingCount) ? { pending: x.wait.pendingCount } : {}) } } : {}) } : null;
  const out = { id: v.id.slice(0, 120), status: v.status };
  for (const k of ['title', 'runtime', 'kind', 'lastToolName', 'model']) if (typeof v[k] === 'string' && v[k]) out[k] = v[k].slice(0, k === 'title' ? 300 : k === 'model' ? 120 : 80);
  for (const k of ['lastActivity', 'progressSummary', 'terminalSummary', 'error']) if (typeof v[k] === 'string' && v[k]) out[k] = v[k].slice(0, 2000);
  for (const k of ['createdAt', 'startedAt', 'endedAt', 'updatedAt']) { const t = when(v[k]); if (t !== undefined) out[k] = t; }
  if (Number.isInteger(v.toolUseCount) && v.toolUseCount >= 0) out.toolUseCount = v.toolUseCount;
  if (typeof v.hasTranscript === 'boolean') out.hasTranscript = v.hasTranscript;
  if (typeof v.here === 'boolean') out.here = v.here;
  if (typeof v.label === 'string' && v.label && !out.title) out.title = v.label.slice(0, 300);
  if (DELIVERY.includes(v.deliveryStatus)) out.deliveryStatus = v.deliveryStatus;
  if (v.terminalOutcome === 'succeeded' || v.terminalOutcome === 'blocked') out.terminalOutcome = v.terminalOutcome;
  if (ex) out.execution = ex;
  if (typeof v.prompt === 'string') out.prompt = v.prompt.slice(0, TEXT_MAX * 2);
  if (typeof v.result === 'string') out.result = v.result.slice(0, ANSWER_MAX);
  return out;
}

/** The whitelisted, length-limited event, or a BusError. */
export function normalize(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || !Object.hasOwn(EVENT_SPEC, raw.type)) throw new BusError(`unknown event type ${raw && raw.type}`);
  const out = { type: raw.type, ts: now };
  for (const [name, spec] of Object.entries({ ...COMMON, ...EVENT_SPEC[raw.type] })) {
    if (spec === 'N!') {
      // (the provider's own operation: its own whitelist, by the event's kind)
      const op = Object.hasOwn(NATIVE, raw.kind) ? NATIVE[raw.kind](raw[name]) : null;
      if (!op) throw new BusError(`${name} is not an operation of ${raw.kind}`);
      out[name] = op;
      continue;
    }
    const v = coerce(name, spec, raw[name]);
    if (v !== undefined) out[name] = v;
  }
  return out;
}

export class EventBus {
  constructor({ log = null } = {}) { this.log = log; this.subs = new Set(); }
  /** Subscribes; returns the function that unsubscribes. */
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  /** Normalizes and delivers to every subscriber; one that throws never stops the others. Returns the event. */
  emit(raw) {
    const e = normalize(raw);
    for (const fn of [...this.subs]) {
      try { fn(e); } catch (err) { this.log?.error?.('[providers] an event subscriber failed:', err.message); }
    }
    return e;
  }
}
