// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Hermes → the universal chat (docs/features/agent-providers.md §9). Pure functions, fed Hermes' gateway events as
// Hermes 0.21 sends them (tests/fixtures/hermes/): a turn's events become the provider bus's events; a session's stored
// messages become the chat window's; a model inventory, session rows and the slash-command catalogue become what its
// pickers and menus show. Each rule follows how Hermes' own Desktop app reads the same event. Nothing here talks to Hermes.
import { splitMedia, mergeMedia } from '../media-lines.js';
import { toolKind as kindOfTool, inputOf } from '../openclaw/translate.js';

export { inputOf };
const OUT_MAX = 4000;
/** Hermes' tools that are the chat's own cards - its questions (clarify) and its task list (todo): shown as those cards,
 *  never also as steps (as OpenClaw's ask_user and progress_card). todo: its tool's name before todo_list. */
export const CARD_TOOLS = new Set(['clarify', 'todo_list', 'todo']);
/** Hermes' tools that reach its deferred tools (offered by search): tool_call carries the call - { calls: [{ name,
 *  arguments }] } - and Hermes reports the called tool itself, live; its stored history keeps the wrapper. */
const BRIDGE = new Set(['tool_call']);
/** The tool a stored call really called: the wrapped one when tool_call carries exactly one. */
export function unwrap(name, args) {
  if (!BRIDGE.has(name) || !args || typeof args !== 'object' || !Array.isArray(args.calls) || args.calls.length !== 1) return { name, args };
  const c = args.calls[0] || {};
  return typeof c.name === 'string' && c.name ? { name: c.name, args: c.arguments ?? {} } : { name, args };
}
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n…` : s);
/** A tool's arguments as the Hermes view's stream and history carry them: JSON, clipped. */
const argsText = a => { if (a === undefined || a === null || a === '') return undefined; try { return (typeof a === 'string' ? a : JSON.stringify(a)).slice(0, 2000); } catch { return undefined; } };
const str = v => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

/** A step's kind (the chat window's icon) from Hermes' tool names (terminal, read_file, patch, web_search …). */
export function toolKind(name) {
  const n = String(name || '').toLowerCase();
  if (/^(terminal|process|shell|execute_code|code_execution)/.test(n)) return 'execute';
  if (/^(read_file|search_files|list|view|vision)/.test(n)) return /search/.test(n) ? 'search' : 'read';
  if (/^(write_file|patch|edit)/.test(n)) return 'edit';
  if (/^(browser|web_extract|web_fetch|fetch)/.test(n)) return 'fetch';
  if (/(search)/.test(n)) return 'search';
  if (/^(delegate|todo|memory|skill)/.test(n)) return 'think';
  return kindOfTool(n);
}
/** A tool's name as a person reads it: Hermes' own label where it gives one (labels[0].text), else the name tidied. */
export function titleOf(name, labels) {
  const l = Array.isArray(labels) && labels[0];
  if (l && typeof l.text === 'string' && l.text.trim()) return l.text.trim().slice(0, 120);
  return String(name || 'tool').replace(/^mcp_/, '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()).slice(0, 120);
}
/** What a step was given, as one line: Hermes' own short context (the command, the file), else its arguments. */
export function stepInput(p) {
  const c = str(p && p.context).trim();
  if (c) return c;
  return inputOf(p && p.args && typeof p.args === 'object' ? p.args : p && p.args_text);
}
/** A tool's result as the step's output, and whether it went well (Hermes' own outcome: a non-zero exit code, an error,
 *  a blocked command). */
export function resultOf(r, fallback = '') {
  if (r === undefined || r === null) return { text: str(fallback), ok: true };
  if (typeof r === 'string') {
    try { const j = JSON.parse(r); if (j && typeof j === 'object') return resultOf(j, fallback); } catch { /* plain text */ }
    return { text: r, ok: true };
  }
  if (typeof r !== 'object') return { text: str(r), ok: true };
  const err = r.error ? str(r.error) : '';
  const exit = Number.isFinite(r.exit_code) ? r.exit_code : undefined;
  const blocked = r.status === 'blocked';
  const body = typeof r.output === 'string' ? r.output : typeof r.content === 'string' ? r.content : typeof r.result === 'string' ? r.result : '';
  let text = body || (blocked && r.user_summary ? str(r.user_summary) : '') || err || '';
  if (!text) { try { text = JSON.stringify(r); } catch { text = ''; } }
  if (err && body) text = `${body}\n${err}`;
  return { text, ok: !err && !blocked && (exit === undefined || exit === 0), ...(exit !== undefined ? { exitCode: exit } : {}), blocked, ...(err ? { error: err } : {}),
    ...(typeof r.diff === 'string' && r.diff ? { diff: r.diff } : {}) };
}
/** Hermes' todo list as the progress card's steps (a cancelled item stays, marked). */
export function stepsOf(todos) {
  return (Array.isArray(todos) ? todos : []).filter(t => t && (t.content || t.text)).slice(0, 50).map(t => {
    const s = String(t.status || 'pending').toLowerCase();
    const text = str(t.content || t.text).slice(0, 290);
    return { step: s === 'cancelled' ? `${text} (cancelled)` : text, status: s === 'in_progress' ? 'in_progress' : s === 'completed' || s === 'cancelled' ? 'completed' : 'pending' };
  });
}
/** Only Hermes' explained waits and reconnects are said (its spinner's other lines are decoration), as its Desktop does. */
export function waitText(text) {
  const v = str(text).trim();
  return /^(?:⏳|⚠|↻|⚙)\s*(?:(?:still\s+)?waiting on|loading|processing prompt|no (?:output|response)|model returned|rate limited|provider (?:overloaded|temporarily unavailable))/i.test(v)
    ? v.replace(/^(?:⏳|⚠|↻|⚙)\s*/, '').slice(0, 120) : '';
}
/** A status line Hermes sends (kind: status, lifecycle, compacting, goal, retry …), in a few words. */
const STATUS_KINDS = new Set(['compacting', 'compression', 'retry', 'fallback', 'status', 'lifecycle', 'goal', 'loop', 'process', 'waiting']);
export function statusText(p) {
  if (!p || !STATUS_KINDS.has(String(p.kind || ''))) return '';
  if (/^compact|^compress/.test(p.kind)) return 'Compacting the conversation';
  return str(p.text).replace(/^[^\p{L}\p{N}]+/u, '').trim().slice(0, 120);
}

/**
 * One run's translation: feed(evt) takes a Hermes event ({ type, payload }) that belongs to this run and emits the
 * universal events through emit(e) (the adapter adds kind, connectionId, agentKey, sessionKey and runId). The answer's
 * text is every segment Hermes wrote (its commentary beside the tools, then its answer), joined as its history keeps them.
 */
export class RunTranslator {
  constructor({ emit }) {
    this.emit = emit; this.segments = []; this.text = ''; this.thinking = ''; this.tools = new Map(); this.model = null; this.effort = null;
    this.ended = false; this.lastPhase = null; this.t0 = Date.now(); this.avail = '';
    // (the Hermes view's stream: which section is open, and how much text and reasoning has gone, for each section's start)
    this.seg = null; this.sent = 0; this.thinkSent = 0;
  }
  /** One operation of Hermes' own stream (native.js), for the chat window's Hermes view. */
  native(op) { this.emit({ type: 'native', ev: op }); }
  status(phase) {
    if (!phase || phase === this.lastPhase) return;
    this.lastPhase = phase;
    this.emit({ type: 'run.status', phase });
  }
  feed(evt) {
    if (this.ended || !evt || typeof evt.type !== 'string') return this.ended;
    const p = evt.payload || {};
    switch (evt.type) {
      case 'message.start': this.status('Thinking'); break;
      // (as Hermes Desktop: a thinking.delta is its spinner's words - out of the conversation -, unless it explains a wait
      // on the provider, which names the wait in the status row under the turn until the next one; compacting says so)
      case 'thinking.delta': { const w = waitText(p.text); if (w) this.status(w); this.native({ op: 'status', kind: 'wait', text: w ? str(p.text).trim().slice(0, 300) : '' }); break; }
      case 'status.update': {
        const s = statusText(p); if (s) this.status(s);
        const k = str(p.kind);
        if (k === 'compacting' || k === 'compressing') this.native({ op: 'status', kind: 'compacting', text: 'Summarizing thread' });
        else if (k === 'compacted' || k === 'ready') this.native({ op: 'status', kind: 'compacting', text: '' });
        break;
      }
      case 'message.delta': this.delta(str(p.text)); break;
      case 'message.interim':
        // (commentary beside its tools, sealed as its own segment; already streamed - else written now)
        if (!p.already_streamed && str(p.text)) this.delta(str(p.text));
        if (this.text) { this.segments.push(this.text); this.text = ''; }
        this.seg = null;
        break;
      case 'reasoning.delta': case 'moa.reference': this.think(str(p.text)); break;
      case 'reasoning.available':
        // (a whole block, for providers that don't stream it - Hermes also relays the model's own words here, so it waits:
        // shown as reasoning unless the answer turns out to be it, and never once the answer has words, as its Desktop does)
        if (!this.text && !this.thinking && str(p.text)) this.avail = str(p.text);
        break;
      // (Hermes' deferred-tool call, tool_call: the tool it calls is the step, as Hermes reports it - nothing to say of the wrapper)
      case 'tool.generating': this.flushAvail(); if (!CARD_TOOLS.has(str(p.name)) && !BRIDGE.has(str(p.name))) this.status(`Preparing ${titleOf(p.name)}`); break;
      case 'tool.start': this.flushAvail(); this.toolStart(p); break;
      case 'tool.complete': this.toolEnd(p); break;
      case 'todo.updated':
        this.emit({ type: 'plan.update', title: 'Tasks', steps: stepsOf(p.todos), ...(Number.isInteger(p.revision) ? { revision: p.revision } : {}), updatedAt: Date.now() });
        this.native({ op: 'todo', items: (Array.isArray(p.todos) ? p.todos : []).map(t => ({ text: str(t && (t.content || t.text)), status: str(t && t.status).toLowerCase() })), ...(Number.isInteger(p.revision) ? { rev: p.revision } : {}) });
        break;
      case 'session.info':
        if (p.model) this.model = p.provider ? `${p.provider}:${p.model}` : String(p.model);
        if (typeof p.reasoning_effort === 'string' && p.reasoning_effort) this.effort = p.reasoning_effort;
        break;
      case 'session.usage': this.usage(p); break;
      // (Hermes names the session and renames it as it goes: the chat follows, live - as its Desktop's list does)
      case 'session.title': if (str(p.title).trim()) { this.title = str(p.title).trim().slice(0, 200); this.native({ op: 'title', text: this.title }); } break;
      case 'message.complete': this.complete(p); break;
      case 'error': this.end('error', { error: str(p.message) || 'Hermes could not answer' }); break;
      default: break;
    }
    return this.ended;
  }
  delta(d) {
    if (!d) return;
    this.lastPhase = null;
    // (a new segment after commentary: a paragraph apart, as its history shows them)
    const lead = !this.text && this.segments.length ? '\n\n' : '';
    if (this.seg !== 'text') { this.seg = 'text'; this.native({ op: 'seg', k: 'text', at: this.sent + lead.length }); }
    this.text += d;
    this.sent += lead.length + d.length;
    this.emit({ type: 'run.delta', text: lead + d });
  }
  think(d) {
    if (!d) return;
    if (this.seg !== 'think') { this.seg = 'think'; this.native({ op: 'seg', k: 'think', at: this.thinkSent }); }
    this.thinking += d;
    this.thinkSent += d.length;
    this.emit({ type: 'run.delta', thinking: d });
  }
  flushAvail() { if (this.avail) { const a = this.avail; this.avail = ''; this.think(a); } }
  toolStart(p) {
    const id = str(p.tool_id) || `t${this.tools.size + 1}`;
    if (this.tools.has(id)) return;
    const t = { id, name: str(p.name) || 'tool', t0: Date.now() };
    this.tools.set(id, t);
    // (the Hermes view: every call, its own cards too - its questions, its todo list - in the order Hermes made them)
    this.seg = null;
    this.native({ op: 'tool', ph: 'start', id, name: t.name, ctx: str(p.context) || undefined, args: argsText(p.args) });
    if (CARD_TOOLS.has(t.name)) { t.hidden = true; return; }
    if (this.text) { this.segments.push(this.text); this.text = ''; }
    const input = stepInput(p);
    this.lastPhase = null;
    let raw = '';
    try { raw = p.args && typeof p.args === 'object' ? JSON.stringify(p.args) : str(p.args_text); } catch { /* its input says enough */ }
    this.emit({ type: 'tool.start', toolId: id, name: t.name, title: titleOf(t.name, p.labels), toolKind: toolKind(t.name), ...(input ? { input } : {}), ...(raw ? { raw } : {}) });
  }
  toolEnd(p) {
    const id = str(p.tool_id);
    let t = id && this.tools.get(id);
    if (!t) { this.toolStart(p); t = this.tools.get(id || `t${this.tools.size}`); }
    if (!t || t.done) return;
    t.done = true;
    const r = resultOf(p.result, p.result_text || p.summary);
    const ms = Number.isFinite(p.duration_s) ? Math.round(p.duration_s * 1000) : Date.now() - t.t0;
    this.native({ op: 'tool', ph: 'end', id: t.id, name: t.name, ok: r.ok, ...(r.exitCode !== undefined ? { exit: r.exitCode } : {}), ms, out: clip(r.text, OUT_MAX) || undefined,
      diff: str(p.inline_diff) || undefined, err: r.ok ? undefined : (r.error || undefined), blocked: r.blocked || undefined });
    if (t.hidden) return;
    const text = clip(str(p.inline_diff) ? `${r.text ? `${r.text}\n` : ''}${p.inline_diff}` : r.text, OUT_MAX);
    this.emit({ type: 'tool.end', toolId: t.id, name: t.name, title: titleOf(t.name, p.labels), ok: r.ok, status: r.blocked ? 'blocked' : r.ok ? 'completed' : 'failed', text,
      ...(r.exitCode !== undefined ? { exitCode: r.exitCode } : {}), ms });
  }
  usage(u) {
    if (!u) return;
    const used = Number.isFinite(u.context_used) ? u.context_used : null, size = Number.isFinite(u.context_max) ? u.context_max : null;
    if (used !== null || size !== null) this.emit({ type: 'usage.update', ...(used !== null ? { used } : {}), ...(size !== null ? { size } : {}), ...(Number.isFinite(u.cost_usd) ? { cost: Math.round(u.cost_usd * 1e6) } : {}) });
  }
  complete(p) {
    const u = p.usage || null;
    this.usage(u);
    const final = str(p.text);
    // (Hermes' relayed words that were the answer: not reasoning)
    if (this.avail && !final.trim().startsWith(this.avail.trim().slice(0, 120))) this.flushAvail();
    this.avail = '';
    const status = p.status === 'interrupted' ? 'stopped' : p.status === 'error' || p.error ? 'error' : 'ok';
    // the answer: every segment written, its last one as Hermes finished it (its final text wins over what streamed)
    const last = final.trim() ? final : this.text;
    const whole = [...this.segments, last].map(s => str(s).trim()).filter(Boolean).join('\n\n');
    this.end(status, { text: whole, usage: u, error: status === 'error' ? (str(p.error) || str(p.failure_reason) || 'Hermes could not answer') : undefined, thinking: str(p.reasoning) || undefined });
  }
  end(status, { text = '', usage = null, error, thinking } = {}) {
    if (this.ended) return;
    this.ended = true;
    const sm = splitMedia(text || [...this.segments, this.text].filter(Boolean).join('\n\n'));
    const e = { type: 'run.end', status, text: sm.text, ms: Date.now() - this.t0 };
    if (sm.media.length) e.media = mergeMedia(sm.media);
    const model = (usage && usage.model && this.model && this.model.endsWith(`:${usage.model}`) ? this.model : null) || this.model || (usage && usage.model) || null;
    if (model) e.model = String(model);
    if (this.effort) e.effort = this.effort;
    const th = this.thinking || thinking || '';
    if (th) e.thinking = th;
    if (usage && Number.isFinite(usage.input)) e.tokensIn = usage.input;
    if (usage && Number.isFinite(usage.output)) e.tokensOut = usage.output;
    if (usage && Number.isFinite(usage.cost_usd)) e.cost = Math.round(usage.cost_usd * 1e6);
    if (error) e.error = String(error).slice(0, 400);
    if (this.title) e.title = this.title.slice(0, 60);
    this.emit(e);
  }
}

// ------------------------------------------------------------------ an approval, a question
/** Hermes' approval choices as the universal decisions (once, this chat, always, deny). */
export const CHOICE_TO_DECISION = Object.freeze({ once: 'allow-once', session: 'allow-session', always: 'allow-always', deny: 'deny' });
export const DECISION_TO_CHOICE = Object.freeze({ 'allow-once': 'once', 'allow-session': 'session', 'allow-always': 'always', deny: 'deny' });
/** Hermes' approval request (a dangerous command) as the chat's approval. */
export function approvalOf(rq) {
  const p = (rq && rq.params) || {};
  const choices = (Array.isArray(p.choices) && p.choices.length ? p.choices : ['once', 'deny']).map(c => CHOICE_TO_DECISION[c]).filter(Boolean);
  return { type: 'approval.requested', approvalId: str(p.request_id || rq.id).slice(0, 190), approvalKind: 'exec', tool: str(p.tool_name) || 'terminal',
    title: p.tool_name && p.tool_name !== 'terminal' ? `Allow ${titleOf(p.tool_name)}` : 'Run a command', summary: str(p.description).slice(0, 1000),
    ...(p.command ? { command: str(p.command) } : {}), options: choices.length ? choices : ['allow-once', 'deny'] };
}
/** Hermes' clarify request (1–5 questions), or a masked prompt (secret, sudo), as the chat's questions. */
export function questionsOf(rq) {
  const p = (rq && rq.params) || {};
  if (rq.method === 'clarify') {
    return (Array.isArray(p.questions) ? p.questions : []).slice(0, 5).filter(q => q && q.qid && q.question).map((q, i) => ({
      questionId: str(q.qid).slice(0, 80), header: `Question ${i + 1}`, question: str(q.question),
      options: (Array.isArray(q.choices) ? q.choices : []).filter(c => typeof c === 'string' && c).slice(0, 8).map(c => ({ label: c.slice(0, 200) })),
      multiSelect: q.multi_select === true, other: true }));
  }
  if (rq.method === 'secret') return [{ questionId: 'value', header: str(p.env_var).slice(0, 40) || 'Secret', question: str(p.prompt) || `Hermes asks for ${str(p.env_var) || 'a secret value'}`, options: [], secret: true, other: true }];
  if (rq.method === 'sudo') return [{ questionId: 'value', header: 'Password', question: p.command ? `Hermes needs your sudo password to run: ${str(p.command).slice(0, 300)}` : 'Hermes needs your sudo password', options: [], secret: true, other: true }];
  return [];
}
/** The chat's answers as the result Hermes' request takes. A clarify choice offered as "X (Recommended)" goes back as
 *  Hermes offered it. */
export function answerFor(rq, answers, cancel) {
  if (rq.method === 'clarify') {
    if (cancel) return {};
    const out = {};
    for (const [qid, v] of Object.entries(answers || {})) {
      const list = (Array.isArray(v) ? v : [v]).map(x => String(x)).filter(Boolean);
      if (list.length) out[qid] = list.join(', ');
    }
    return { answers: out };
  }
  if (rq.method === 'secret' || rq.method === 'sudo') {
    const v = answers && (Array.isArray(answers.value) ? answers.value[0] : answers.value);
    return { value: cancel ? '' : String(v || '') };
  }
  return {};
}

// ------------------------------------------------------------------ the session's stored messages
const parseArgs = a => { if (a && typeof a === 'object') return a; try { return JSON.parse(a || '{}'); } catch { return a || ''; } };
/**
 * A session's stored messages (GET /api/sessions/{id}/messages: OpenAI-shaped rows - user, assistant with its tool calls
 * and reasoning, tool results) as the chat window's: the person's messages, and each answer - the assistant's turn
 * between two of the person's, its words, its reasoning and every step (a tool call with its result). Rows Hermes keeps
 * hidden (its own scaffolding prompts) are not shown; a compaction is marked.
 */
export function historyOf(rows, { visible = null } = {}) {
  const out = [];
  let turn = null, n = 0;   // (n: the record's entries so far - Hermes counts them for a branch)
  const close = () => { if (turn) { if (turn.text || turn.meta.parts.length || turn.meta.thinking || turn.meta.media.length) out.push(tidy(turn)); turn = null; } };
  for (let m of Array.isArray(rows) ? rows : []) {
    if (!m || typeof m !== 'object' || m.active === 0) continue;
    n++;
    const ts = Number.isFinite(m.timestamp) ? Math.round(m.timestamp * 1000) : null;
    let dk = str(m.display_kind);
    // (a turn stopped or redirected part-way: Hermes keeps its row hidden and empty, and shows what it wrote from its
    // live transcript - `visible`, its session.history by row - as its Desktop does)
    if (dk === 'hidden' && m.role === 'assistant' && !str(m.content).trim() && visible && visible.has(Number(m.id))) {
      const v = visible.get(Number(m.id));
      m = { ...m, content: str(v.text), reasoning: v.reasoning || m.reasoning, display_kind: null }; dk = '';
    }
    if (dk === 'hidden') continue;
    if (m.role === 'user') {
      close();
      if (dk && dk !== 'user') { out.push({ role: 'system', text: str((m.display_metadata && m.display_metadata.display_text) || m.content).slice(0, 2000) || 'Hermes continued by itself.', ts, status: dk }); continue; }
      // (its row in Hermes' record: what an edit or a checkpoint goes back to)
      // (a skill command: Hermes stores the skill's whole text it expanded to - shown as the command, as its Desktop does)
      const said = userText(m.content), skill = skillInvocationText(said);
      out.push({ role: 'user', text: skill || said, ts, ...(Number.isInteger(m.id) || skill ? { meta: { ...(Number.isInteger(m.id) ? { row: m.id } : {}), ...(skill ? { skill: true } : {}) } } : {}) });
      continue;
    }
    if (m.role === 'system' && /compact|compress/i.test(dk)) { close(); out.push({ role: 'system', text: 'The conversation was compacted here.', ts, status: 'compaction' }); continue; }
    if (m.role === 'assistant') {
      if (!turn) turn = { role: 'assistant', text: '', ts, meta: { steps: [], thinking: '', media: [], parts: [], upto: n } };
      turn.meta.upto = n;
      const th = str(m.reasoning_content || m.reasoning);
      if (th) { turn.meta.thinking += (turn.meta.thinking ? '\n\n' : '') + th; turn.meta.parts.push({ t: 'think', text: th }); }
      const sm = splitMedia(str(m.content));
      turn.meta.media = mergeMedia(turn.meta.media, sm.media);
      if (sm.text.trim()) { turn.text += (turn.text ? '\n\n' : '') + sm.text.trim(); turn.meta.parts.push({ t: 'text', text: sm.text.trim() }); }
      for (const c of Array.isArray(m.tool_calls) ? m.tool_calls : []) {
        const fn = (c && c.function) || {};
        const id = str(c && (c.id || c.call_id));
        if (!id) continue;
        const { name, args } = unwrap(str(fn.name) || 'tool', parseArgs(fn.arguments));
        // (the Hermes view: every call in order, its cards too)
        turn.meta.parts.push({ t: 'tool', id, name, ...(argsText(args) ? { args: argsText(args) } : {}) });
        if (CARD_TOOLS.has(name)) continue;
        turn.meta.steps.push({ id, name, title: titleOf(name), kind: toolKind(name), input: inputOf(args) });
      }
      continue;
    }
    if (m.role === 'tool' && turn) {
      turn.meta.upto = n;
      const r = resultOf(m.content);
      const s = turn.meta.steps.find(x => x.id === str(m.tool_call_id));
      if (s) { s.output = clip(r.text, OUT_MAX); s.ok = r.ok; if (r.exitCode !== undefined) s.exitCode = r.exitCode; }
      const pt = turn.meta.parts.find(x => x.t === 'tool' && x.id === str(m.tool_call_id));
      if (pt) Object.assign(pt, { done: true, ok: r.ok, out: clip(r.text, OUT_MAX) }, r.exitCode !== undefined ? { exit: r.exitCode } : {}, r.error ? { err: r.error.slice(0, 1000) } : {},
        r.blocked ? { blocked: true } : {}, r.diff ? { diff: r.diff.slice(0, 8000) } : {});
    }
  }
  close();
  return out;
}
// A skill command (/work fix the leak) reaches the model as the skill's whole text, which Hermes stores; its Desktop shows
// the command instead (@hermes/shared skill-scaffold.ts, MIT, Nous Research - the markers mirror agent/skill_commands.py).
const SK_PREFIX = '[IMPORTANT: The user has invoked the ', SK_SINGLE = 'The full skill content is loaded below.]', SK_INSTR = 'The user has provided the following instruction alongside the skill invocation: ';
const SK_RUNTIME = '\n\n[Runtime note:', SK_BUNDLE = ' skill bundle,', SK_BUNDLE_INSTR = '\nUser instruction: ', SK_BUNDLE_BLOCK = '\n\n[Loaded as part of the ';
const between = (t, marker, end, fromEnd = false) => { const i = fromEnd ? t.lastIndexOf(marker) : t.indexOf(marker); if (i < 0) return ''; const tail = t.slice(i + marker.length), k = tail.indexOf(end); return (k >= 0 ? tail.slice(0, k) : tail).trim(); };
/** The command a skill's expanded text came from (`/work fix the leak`), or null for ordinary words. */
export function skillInvocationText(t) {
  if (typeof t !== 'string' || !t.startsWith(SK_PREFIX)) return null;
  const name = ((/^\[IMPORTANT: The user has invoked the "([^"]*)"/.exec(t) || [])[1] || '').trim();
  if (!name) return null;
  const label = name.startsWith('/') ? name : `/${name}`;
  const instr = t.includes(SK_BUNDLE) ? between(t, SK_BUNDLE_INSTR, SK_BUNDLE_BLOCK) : t.includes(SK_SINGLE) ? between(t, SK_INSTR, SK_RUNTIME, true) : '';
  return (instr ? `${label} ${instr.replace(/\s+/g, ' ')}` : label).slice(0, 2000);
}
function userText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter(p => p && (p.type === 'text' || p.type === 'input_text')).map(p => str(p.text)).join('');
  return str(c);
}
function tidy(turn) {
  const meta = { ...turn.meta };
  // (the Hermes view draws the turn from its parts: the steps, the universal view's, would only repeat them)
  if (meta.parts && meta.parts.length) delete meta.steps; else delete meta.parts;
  if (meta.steps && !meta.steps.length) delete meta.steps;
  if (!meta.thinking) delete meta.thinking;
  if (!meta.media.length) delete meta.media;
  return { role: 'assistant', text: turn.text, ts: turn.ts, meta };
}

// ------------------------------------------------------------------ pickers and lists
/** The reasoning levels Hermes takes for a model that reasons (its Desktop's stepper), 'none' where it may be switched off. */
export const EFFORT_LEVELS = Object.freeze(['minimal', 'low', 'medium', 'high', 'xhigh']);
const EFFORT_LABEL = { none: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high' };
/** A model's id here: Hermes' own provider:model (what its /model command takes; a model's name may have slashes). */
export const modelRef = (provider, model) => `${provider}:${model}`;
export function parseModelRef(ref) {
  const s = str(ref), i = s.indexOf(':');
  return i > 0 ? { provider: s.slice(0, i), model: s.slice(i + 1) } : { provider: '', model: s };
}
/** Hermes' model inventory (model.options) as the model picker's: the providers signed in (and the one in use), their
 *  models, which reason and how far. */
export function modelsOf(r) {
  const providers = (r && Array.isArray(r.providers) ? r.providers : []).filter(p => p && p.slug && (p.authenticated !== false || p.is_current));
  const models = [];
  for (const p of providers) {
    for (const m of (Array.isArray(p.models) ? p.models : []).slice(0, 200)) {
      if (typeof m !== 'string' || !m || (Array.isArray(p.unavailable_models) && p.unavailable_models.includes(m))) continue;
      const cap = (p.capabilities && p.capabilities[m]) || {};
      const effort = cap.reasoning ? [...(cap.can_disable_reasoning ? ['none'] : []), ...EFFORT_LEVELS].map(id => ({ id, label: EFFORT_LABEL[id] })) : undefined;
      models.push({ id: modelRef(p.slug, m), label: `${m} · ${p.name || p.slug}`, reasoning: !!cap.reasoning, ...(effort ? { effort } : {}) });
      if (models.length >= 400) break;
    }
  }
  return { default: r && r.provider && r.model ? modelRef(r.provider, r.model) : null, models };
}
/** A stored session row (REST /api/sessions, or session.list) as the chat's: its title, when it changed, its model, where
 *  it came from (Telegram, cron, Desktop …). */
export function sessionOf(row) {
  const title = str(row.title) || str(row.preview).slice(0, 60) || 'Chat';
  const at = Number.isFinite(row.last_activity_at) ? row.last_activity_at : Number.isFinite(row.ended_at) ? row.ended_at : row.started_at;
  return { key: str(row.id), title: title.slice(0, 120), updatedAt: Number.isFinite(at) ? Math.round(at * 1000) : null, model: row.model ? str(row.model) : null,
    source: row.source ? str(row.source).slice(0, 40) : null, messages: Number.isFinite(row.message_count) ? row.message_count : undefined };
}
/** Hermes' slash-command catalogue (commands.catalog: [name, description] pairs, by category) for the composer's / menu. */
export function commandsOf(r) {
  const seen = new Set(), out = [];
  const add = (pair, category) => {
    if (!Array.isArray(pair) || typeof pair[0] !== 'string' || !pair[0].startsWith('/')) return;
    const name = pair[0].replace(/^\//, '').split(/\s/)[0];
    if (!name || seen.has(name)) return;
    seen.add(name);
    const desc = str(pair[1]);
    const usage = /\(usage: ([^)]*)\)/.exec(desc);
    out.push({ name, alias: `/${name}`, description: desc.replace(/\s*\(usage: [^)]*\)/, '').slice(0, 200), category: category || null,
      args: usage && /</.test(usage[1]) ? [{ name: (/<([^>]+)>/.exec(usage[1]) || [])[1] || 'value', description: usage[1].slice(0, 120), required: !/\[/.test(usage[1].split('<')[0]) }] : [] });
  };
  for (const c of r && Array.isArray(r.categories) ? r.categories : []) for (const p of c.pairs || []) add(p, c.name);
  for (const p of r && Array.isArray(r.pairs) ? r.pairs : []) add(p, null);
  return out.slice(0, 300);
}
