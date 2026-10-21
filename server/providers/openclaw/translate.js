// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// OpenClaw → the universal chat (docs/features/agent-providers.md §4–§5). Pure functions, fed the gateway's frames as
// OpenClaw 2026.9 sends them (tests/fixtures/openclaw/): a run's events become the provider bus's events, a session's
// history becomes the chat window's messages, a session row and a model list become what its pickers and meter show.
// Nothing here talks to the gateway.
import { splitMedia, mergeMedia, baseName, kindOfName } from '../media-lines.js';

export { splitMedia, mergeMedia };

/** What the person reads while a run gets ready (OpenClaw's run phases; anything else: its own words, tidied). */
export const PHASE_TEXT = Object.freeze({
  preparing_workspace: 'Preparing the workspace', naming_worktree: 'Naming the worktree', creating_worktree: 'Creating the worktree',
  running_setup: 'Running setup', provisioning_environment: 'Preparing the environment', preparing_context: 'Reading the conversation',
  memory_flushing: 'Saving memories', starting_model: 'Starting the model', 'waiting-approval': 'Waiting for your approval',
  compacting: 'Compacting the conversation', 'waiting-answer': 'Waiting for your answer',
});
export const phaseText = p => PHASE_TEXT[p] || String(p || '').replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase()).slice(0, 80);

/** OpenClaw's tools that are the chat's own cards - the agent's questions (ask_user) and its plan (progress_card) - and
 *  its deferred-tool call that may carry one (tool_call { id }): shown as those cards, never also as steps. */
export const CARD_TOOLS = new Set(['ask_user', 'progress_card']);
const cardTool = (name, args) => CARD_TOOLS.has(String(name)) || (String(name) === 'tool_call' && args && CARD_TOOLS.has(String(args.id || '').replace(/^.*:/, '')));
/** OpenClaw's deferred-tool call (tools offered by search): it calls another tool, which OpenClaw reports itself - with
 *  `parentToolCallId` naming the call - live and in the history. That tool is the step; the wrapper shows only when
 *  nothing came of it (a gateway that doesn't report it). */
const WRAPPER = 'tool_call';
/** The browser tab a browser tool's result leaves (its details: browserTab, or the tab it navigated): the chat shows a card
 *  for it, as OpenClaw's Control UI does. */
export function tabOf(name, det) {
  const t = det && det.browserTab && typeof det.browserTab === 'object' ? det.browserTab : String(name) === 'browser' && det && det.targetId && det.url ? det : null;
  if (!t || typeof t.targetId !== 'string' || typeof t.url !== 'string' || !/^https?:/i.test(t.url)) return null;
  return { targetId: t.targetId.slice(0, 128), url: t.url.slice(0, 2048), ...(typeof t.title === 'string' && t.title ? { title: t.title.slice(0, 300) } : {}) };
}

/** What kind of step a tool is (the Agent Client Protocol's tool kinds: the chat window picks its icon from it). */
export function toolKind(name) {
  const n = String(name || '').toLowerCase();
  if (/^(exec|process|bash|shell|run|terminal|command)/.test(n)) return 'execute';
  if (/^(read|ls|cat|view|open|list)/.test(n)) return 'read';
  if (/^(write|edit|apply_patch|patch|create)/.test(n)) return 'edit';
  if (/^(delete|rm|remove)/.test(n)) return 'delete';
  if (/^(move|mv|rename)/.test(n)) return 'move';
  if (/(search|find|grep|glob|query)/.test(n)) return 'search';
  if (/(fetch|http|web|browse|url)/.test(n)) return 'fetch';
  if (/(think|plan|reason)/.test(n)) return 'think';
  return 'other';
}

// ------------------------------------------------------------------ media (images, video, audio an answer carries)
// OpenClaw's agents attach files with a line of their own, `MEDIA:<path or URL>` (its reply directives; the lines are
// read by ../media-lines.js). Its history turns those it keeps into media blocks (image, video, audio: an artifact id,
// the type, the size); a line it leaves in the text - an absolute path, a run through an outside CLI - is fetched by its
// own UI from the path. Both become the universal chat's media: { kind, name, mime, w, h, size, ref } - ref { artifactId }
// or { source }.
const MEDIA_KINDS = new Set(['image', 'video', 'audio', 'file']);
/** The media blocks of a message's content (the ones OpenClaw keeps: each with its artifact id). */
export function mediaBlocks(content) {
  if (!Array.isArray(content)) return [];
  return content.filter(p => p && MEDIA_KINDS.has(p.type) && typeof p.artifactId === 'string' && p.artifactId).slice(0, 24).map(p => {
    const name = String(p.fileName || p.alt || p.title || baseName(p.url) || p.type).slice(0, 200);
    return { kind: p.type === 'file' ? kindOfName(name) : p.type, name, ...(p.mimeType ? { mime: String(p.mimeType).slice(0, 100) } : {}),
      ...(Number.isFinite(p.width) ? { w: p.width } : {}), ...(Number.isFinite(p.height) ? { h: p.height } : {}), ...(Number.isFinite(p.sizeBytes) ? { size: p.sizeBytes } : {}),
      ref: { artifactId: p.artifactId.slice(0, 200) } };
  });
}
/** A message's media in the order it shows them - its MEDIA lines and its kept blocks - with its text without the lines. */
export function mediaOf(content) {
  if (!Array.isArray(content)) { const sm = splitMedia(typeof content === 'string' ? content : ''); return { text: sm.text, media: sm.media }; }
  let text = '', media = [];
  for (const p of content) {
    if (!p) continue;
    if (p.type === 'text' && typeof p.text === 'string') { const sm = splitMedia(p.text); text += sm.text; media = mergeMedia(media, sm.media); }
    else if (MEDIA_KINDS.has(p.type)) media = mergeMedia(media, mediaBlocks([p]));
  }
  return { text, media };
}
/** The text of a message's content: a string, or its text parts joined. */
export function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(p => p && p.type === 'text' && typeof p.text === 'string').map(p => p.text).join('');
}
/** A tool's input as one readable line: its command, its path, or its arguments. */
export function inputOf(args) {
  if (args === undefined || args === null) return '';
  if (typeof args === 'string') return args;
  if (typeof args.command === 'string') return args.command;
  if (typeof args.path === 'string' && Object.keys(args).length <= 2) return args.path;
  try { return JSON.stringify(args); } catch { return ''; }
}
/** A tool's arguments whole, as JSON (the bus cuts it to its length): what its PC's screens read (server/pc/recognize.js). */
export function rawOf(args) {
  if (!args || typeof args !== 'object') return '';
  try { return JSON.stringify(args); } catch { return ''; }
}
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n…` : s);
const OUT_MAX = 4000;

/**
 * One run's translation. feed(frame) takes a gateway event frame ({ event, payload }) that belongs to this run and
 * emits the universal events through emit(e) (e carries type and its own fields; the adapter adds kind, connectionId,
 * agentKey, sessionKey and runId). Returns true once the run has ended.
 */
export class RunTranslator {
  constructor({ emit }) {
    this.emit = emit; this.text = ''; this.thinking = ''; this.tools = new Map(); this.model = null; this.ended = false;
    this.lastPhase = null; this.t0 = Date.now(); this.approvals = new Map();
  }
  feed(frame) {
    if (this.ended || !frame || (!frame.payload && frame.event !== 'progress.card')) return this.ended;   // (a card of null: taken off)
    const p = frame.payload;
    switch (frame.event) {
      case 'chat': this.chat(p); break;
      case 'agent': this.agent(p); break;
      case 'exec.approval.requested': case 'plugin.approval.requested': this.approvalAsked(frame.event.startsWith('exec') ? 'exec' : 'plugin', p); break;
      case 'exec.approval.resolved': case 'plugin.approval.resolved': this.approvalAnswered(p); break;
      case 'question.requested': this.asked(p); break;
      case 'question.resolved': this.answered(p); break;
      case 'progress.card': this.card(p); break;
      default: break;
    }
    return this.ended;
  }
  status(phase) {
    if (!phase || phase === this.lastPhase) return;
    this.lastPhase = phase;
    this.emit({ type: 'run.status', phase: phaseText(phase) });
  }
  chat(p) {
    if (p.state === 'status') { this.status(p.phase); return; }
    if (p.state === 'delta') {
      const d = typeof p.deltaText === 'string' ? p.deltaText : '';
      // (followed from the middle - a run on another channel a page started watching: the answer so far, whole)
      const whole = !this.text && p.message ? textOf(p.message.content) : '';
      if (p.replace || (whole && whole !== d)) {
        // (the gateway rewrote what was written so far: the whole of it, from the start)
        this.text = whole || d || textOf(p.message && p.message.content);
        this.emit({ type: 'run.delta', text: this.text, replace: true });
      } else if (d) { this.text += d; this.emit({ type: 'run.delta', text: d }); }
      return;
    }
    if (p.state === 'final' || p.state === 'aborted' || p.state === 'error') {
      const fin = p.message && p.message.content !== undefined ? mediaOf(p.message.content) : { text: '', media: [] };
      const sm = fin.text ? fin : { ...splitMedia(this.text), media: mergeMedia(fin.media, splitMedia(this.text).media) };
      const status = p.state === 'final' ? 'ok' : p.state === 'aborted' ? 'stopped' : 'error';
      const u = p.usage || (p.message && p.message.usage) || null;
      const e = { type: 'run.end', status, text: sm.text, ms: Date.now() - this.t0 };
      if (sm.media.length) e.media = sm.media;
      if (this.model) e.model = this.model;
      if (this.thinking) e.thinking = this.thinking;
      if (u && Number.isFinite(u.input)) e.tokensIn = u.input;
      if (u && Number.isFinite(u.output)) e.tokensOut = u.output;
      if (status === 'error') {
        const d = p.errorDetail || {};
        e.error = [p.errorMessage || 'The agent could not answer', d.httpStatus ? `(${d.provider || 'provider'} ${d.httpStatus})` : ''].filter(Boolean).join(' ').slice(0, 400);
      }
      this.ended = true;
      this.emit(e);
    }
  }
  agent(p) {
    const d = p.data || {};
    switch (p.stream) {
      case 'thinking': if (typeof d.delta === 'string' && d.delta) { this.thinking += d.delta; this.emit({ type: 'run.delta', thinking: d.delta }); } break;
      case 'lifecycle':
        if (d.phase === 'model' && d.model) this.model = d.provider ? `${d.provider}/${d.model}` : d.model;
        if (d.phase === 'waiting-approval') this.status('waiting-approval');
        if (d.phase === 'approval-resolved') this.lastPhase = null;
        if (d.phase === 'compaction' || d.phase === 'compacting') this.status('compacting');
        break;
      case 'item': {
        if (d.kind !== 'tool' || !d.toolCallId) break;
        const t = this.tool(d.toolCallId, d.name);
        if (d.title) t.title = String(d.title);
        // (a step that runs a command streams its output as command_output: its partial results would repeat it)
        if (d.commandBearing) t.streamed = true;
        // (a deferred-tool call shows once its arguments say what it calls; a card's own tool never shows)
        if (d.phase === 'start' && !t.started && !cardTool(t.name) && t.name !== 'tool_call') this.startTool(t);
        break;
      }
      case 'tool': {
        if (!d.toolCallId) break;
        const t = this.tool(d.toolCallId, d.name);
        if (d.phase === 'start' && cardTool(t.name, d.args)) t.hidden = true;
        if (t.hidden) break;
        if (d.parentToolCallId && this.tools.has(String(d.parentToolCallId))) this.tools.get(String(d.parentToolCallId)).child = true;
        if (t.name === WRAPPER && !(d.phase === 'result' && !t.child)) { if (d.phase === 'start') t.input = inputOf(d.args); break; }
        if (d.phase === 'start') {
          t.input = inputOf(d.args); t.raw = rawOf(d.args);
          if (!t.started) this.startTool(t); else if (t.input) this.emit({ type: 'tool.update', toolId: t.id, input: t.input, ...(t.raw ? { raw: t.raw } : {}) });
        } else if (d.phase === 'update' && !t.streamed) {
          // (a tool without a command's live output: its latest partial result, whole)
          const out = textOf(d.partialResult && d.partialResult.content);
          if (out) this.emit({ type: 'tool.update', toolId: t.id, text: clip(out, OUT_MAX), replace: true, status: 'running' });
        } else if (d.phase === 'result') {
          const r = d.result || {}, det = r.details || {};
          if (!t.started) this.startTool(t);
          const e = { type: 'tool.end', toolId: t.id, name: t.name, ok: !d.isError, status: d.isError ? 'failed' : 'completed', text: clip(textOf(r.content) || String(det.aggregated || ''), OUT_MAX) };
          if (Number.isFinite(det.exitCode)) e.exitCode = det.exitCode;
          if (Number.isFinite(det.durationMs)) e.ms = det.durationMs;
          if (typeof det.cwd === 'string') e.cwd = det.cwd;
          if (t.title) e.title = t.title;
          const tab = !d.isError && tabOf(t.name, det);
          if (tab) e.tab = tab;
          t.done = true;
          this.emit(e);
        }
        break;
      }
      case 'plan':
        if (Array.isArray(d.steps)) this.emit({ type: 'plan.update', title: String(d.title || 'Plan'), steps: d.steps, ...(d.explanation ? { explanation: String(d.explanation) } : {}) });
        break;
      case 'command_output': {
        if (!d.toolCallId) break;
        const t = this.tool(d.toolCallId, d.name);
        if (t.hidden) break;
        if (d.phase === 'delta' && typeof d.output === 'string' && d.output) {
          // (each delta is the new output; the line it ends is closed by the next)
          t.streamed = true;
          this.emit({ type: 'tool.update', toolId: t.id, text: t.out ? `\n${d.output}` : d.output, status: 'running' });
          t.out = true;
        }
        break;
      }
      default: break;
    }
  }
  tool(id, name) {
    let t = this.tools.get(id);
    if (!t) { t = { id: String(id), name: String(name || 'tool'), started: false }; this.tools.set(t.id, t); }
    if (name && t.name === 'tool') t.name = String(name);
    return t;
  }
  startTool(t) {
    t.started = true;
    this.emit({ type: 'tool.start', toolId: t.id, name: t.name, title: t.title || t.name, toolKind: toolKind(t.name), ...(t.input ? { input: t.input } : {}), ...(t.raw ? { raw: t.raw } : {}) });
  }
  /** The agent asks the person (ask_user): its questions, as the gateway sends them. */
  asked(p) {
    if (!p.id || !Array.isArray(p.questions) || !p.questions.length) return;
    this.questions = this.questions || new Map();
    this.questions.set(String(p.id), p.questions.map(q => !!q.isSecret));
    this.emit({ type: 'question.requested', questionId: String(p.id), questions: p.questions, ...(Number.isFinite(p.expiresAtMs) ? { expiresAt: p.expiresAtMs } : {}) });
    this.status('waiting-answer');
  }
  answered(p) {
    if (!p.id || !this.questions || !this.questions.has(String(p.id))) return;
    const secret = this.questions.get(String(p.id));
    this.questions.delete(String(p.id));
    const a = p.answers && p.answers.answers;
    // (a secret's answer never travels on: whether it was answered is enough)
    this.emit({ type: 'question.resolved', questionId: String(p.id), status: String(p.status || 'answered'), ...(a && !secret.some(Boolean) ? { answers: a } : {}) });
    this.lastPhase = null;
  }
  /** The session's progress card (fetched when the gateway says it changed): its notes and steps. */
  card(c) {
    this.emit({ type: 'plan.update', title: 'Plan', steps: c && Array.isArray(c.steps) ? c.steps : [], markdown: c && c.markdown ? String(c.markdown) : '',
      ...(c && Number.isInteger(c.revision) ? { revision: c.revision } : {}), ...(c && Number.isFinite(c.updatedAt) ? { updatedAt: c.updatedAt } : {}) });
  }
  approvalAsked(kind, p) {
    const r = p.request || {};
    const id = String(p.id || '');
    if (!id || this.approvals.has(id)) return;
    this.approvals.set(id, true);
    const risks = r.commandAnalysis && Array.isArray(r.commandAnalysis.warningLines) ? r.commandAnalysis.warningLines : [];
    const e = { type: 'approval.requested', approvalId: id, approvalKind: kind, tool: kind === 'exec' ? 'exec' : String(r.toolName || r.pluginId || 'plugin'),
      title: kind === 'exec' ? 'Run a command' : String(r.title || r.summary || 'Allow this action').slice(0, 200),
      summary: String(r.warningText || risks.join(' ') || r.description || '').slice(0, 1000),
      options: Array.isArray(r.allowedDecisions) && r.allowedDecisions.length ? r.allowedDecisions.filter(x => typeof x === 'string').slice(0, 6) : ['allow-once', 'deny'] };
    if (typeof r.command === 'string') e.command = r.command;
    if (typeof r.cwd === 'string') e.cwd = r.cwd;
    if (Number.isFinite(p.expiresAtMs)) e.expiresAt = p.expiresAtMs;
    this.emit(e);
  }
  approvalAnswered(p) {
    const id = String(p.id || '');
    if (!id || !this.approvals.has(id)) return;
    this.approvals.delete(id);
    this.emit({ type: 'approval.resolved', approvalId: id, approved: p.decision !== 'deny', decision: String(p.decision || '') });
  }
}

/**
 * A session's history (chat.history's messages) as the chat window's: the person's messages, and each answer - the
 * assistant's turn between two of the person's, its text, the reasoning it showed and every step it took (a tool call
 * with its result) - with what it took.
 */
export function historyOf(messages) {
  const out = [];
  let turn = null;
  const close = () => { if (turn) { if (turn.text || turn.meta.steps.length || turn.meta.thinking || turn.meta.media.length) out.push(tidy(turn)); turn = null; } };
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || typeof m !== 'object') continue;
    const meta = m.__openclaw || {};
    if (meta.kind === 'compaction') { close(); out.push({ role: 'system', text: 'The conversation was compacted here.', ts: m.timestamp || null, status: 'compaction' }); continue; }
    if (meta.kind === 'reset') { close(); out.push({ role: 'system', text: 'The session was reset here.', ts: m.timestamp || null, status: 'reset' }); continue; }
    if (m.role === 'user') {
      close();
      const files = Array.isArray(m.content) ? m.content.filter(p => p && (p.type === 'image' || p.type === 'file')).map(p => ({ name: p.fileName || p.alt || (p.type === 'image' ? 'image' : 'file'), mime: p.mimeType || '' })) : [];
      out.push({ role: 'user', text: textOf(m.content), ts: m.timestamp || null, ...(files.length ? { meta: { files } } : {}) });
      continue;
    }
    if (m.role === 'assistant') {
      if (!turn) turn = { role: 'assistant', text: '', ts: m.timestamp || null, meta: { steps: [], thinking: '', media: [] } };
      for (const p of Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content || '') }]) {
        if (!p) continue;
        if (MEDIA_KINDS.has(p.type)) turn.meta.media = mergeMedia(turn.meta.media, mediaBlocks([p]));
        else if (p.type === 'text' && p.text) {
          const sm = splitMedia(p.text);
          turn.meta.media = mergeMedia(turn.meta.media, sm.media);
          if (sm.text) turn.text += (turn.text ? '\n\n' : '') + sm.text;
        }
        else if (p.type === 'thinking' && p.thinking) turn.meta.thinking += (turn.meta.thinking ? '\n\n' : '') + p.thinking;
        else if (p.type === 'toolCall' && p.id && !cardTool(p.name, p.arguments)) turn.meta.steps.push(stepOf(p));
      }
      if (m.model) turn.meta.model = m.provider ? `${m.provider}/${m.model}` : m.model;
      if (m.usage) {
        if (Number.isFinite(m.usage.input)) turn.meta.tokensIn = (turn.meta.tokensIn || 0) + m.usage.input;
        if (Number.isFinite(m.usage.output)) turn.meta.tokensOut = (turn.meta.tokensOut || 0) + m.usage.output;
      }
      continue;
    }
    if (m.role === 'toolResult' && turn) {
      const s = turn.meta.steps.find(x => x.id === String(m.toolCallId));
      if (s) resultInto(s, m);
    }
    // (what a deferred-tool call called, and its result: the step it shows as)
    if (m.role === 'custom' && turn && Array.isArray(m.content)) {
      for (const p of m.content) {
        if (!p || !p.parentToolCallId) continue;
        const parent = turn.meta.steps.find(x => x.id === String(p.parentToolCallId));
        if (p.type === 'toolCall' && p.id) {
          if (parent) parent.wrapper = true;
          if (!cardTool(p.name, p.arguments)) turn.meta.steps.push(stepOf(p));
        } else if (p.type === 'toolResult' && p.toolCallId) {
          const s = turn.meta.steps.find(x => x.id === String(p.toolCallId));
          if (s) resultInto(s, p);
        }
      }
    }
  }
  close();
  return out;
}
/** A step of the history: the tool, what it was given. */
function stepOf(p) {
  return { id: String(p.id), name: String(p.name || 'tool'), title: String(p.name || 'tool').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()), kind: toolKind(p.name), input: inputOf(p.arguments) };
}
/** A tool's result into its step: its output, whether it went well, what it took - and the browser tab it left. */
function resultInto(s, m) {
  const det = m.details || {};
  s.output = clip(textOf(m.content) || String(det.aggregated || ''), OUT_MAX); s.ok = !m.isError;
  if (Number.isFinite(det.exitCode)) s.exitCode = det.exitCode;
  if (Number.isFinite(det.durationMs)) s.ms = det.durationMs;
  const tab = !m.isError && tabOf(s.name, det);
  if (tab) s.tab = tab;
}
function tidy(turn) {
  const meta = { ...turn.meta, steps: turn.meta.steps.filter(x => !x.wrapper) };
  if (!meta.steps.length) delete meta.steps;
  if (!meta.thinking) delete meta.thinking;
  if (!meta.media || !meta.media.length) delete meta.media;
  return { role: 'assistant', text: turn.text, ts: turn.ts, meta };
}

/** A model list (models.list) as the model picker's: ids as OpenClaw names them in a session (provider/model). */
export function modelsOf(r, current = null) {
  const list = (r && Array.isArray(r.models) ? r.models : []).filter(m => m && m.id && m.available !== false);
  const ref = m => (m.provider ? `${m.provider}/${m.id}` : m.id);
  const def = list.find(m => Array.isArray(m.tags) && m.tags.includes('default'));
  return {
    default: current || (def ? ref(def) : null),
    models: list.slice(0, 300).map(m => ({
      id: ref(m), label: String(m.name || m.id), context: Number.isFinite(m.contextWindow) ? m.contextWindow : undefined,
      images: Array.isArray(m.input) ? m.input.includes('image') : undefined, reasoning: !!m.reasoning,
      effort: Array.isArray(m.thinkingLevels) ? m.thinkingLevels.filter(x => x && x.id).map(x => ({ id: String(x.id), label: String(x.label || x.id) })) : undefined,
      effortDefault: m.thinkingDefault || undefined,
    })),
  };
}

/** A session row (sessions.list) as the chat's: its title, when it changed, its model and its context use. */
export function sessionOf(row) {
  const title = row.label || row.displayName || row.derivedTitle || (row.lastMessagePreview ? String(row.lastMessagePreview).slice(0, 60) : '') || 'Chat';
  return { key: String(row.key), title: String(title).slice(0, 120), updatedAt: row.updatedAt || row.createdAt || null,
    model: row.model ? (row.modelProvider ? `${row.modelProvider}/${row.model}` : row.model) : null, effort: row.thinkingLevel || null,
    usage: usageOf(row), active: !!row.hasActiveRun, kind: row.classification || row.kind || null };
}
/** The slash commands a person may type (commands.list): name, what it does, its arguments. */
export function commandsOf(r) {
  return (r && Array.isArray(r.commands) ? r.commands : []).filter(c => c && c.name && c.scope !== 'native').slice(0, 300).map(c => ({
    name: String(c.name), alias: Array.isArray(c.textAliases) && c.textAliases[0] ? String(c.textAliases[0]) : `/${c.name}`, description: String(c.description || '').slice(0, 200),
    category: c.category || null, args: Array.isArray(c.args) ? c.args.slice(0, 6).map(a => ({ name: String(a.name), description: String(a.description || '').slice(0, 120), required: !!a.required,
      choices: Array.isArray(a.choices) ? a.choices.slice(0, 12).map(x => String(x.value ?? x)) : undefined })) : [] }));
}
/** The context meter: tokens in the conversation now, of the model's window. */
export function usageOf(row) {
  if (!row) return null;
  const used = Number.isFinite(row.totalTokens) ? row.totalTokens : null, size = Number.isFinite(row.contextTokens) ? row.contextTokens : null;
  if (used === null && size === null) return null;
  return { used, size, cost: Number.isFinite(row.estimatedCostUsd) ? Math.round(row.estimatedCostUsd * 1e6) : undefined, fresh: row.totalTokensFresh !== false };
}
