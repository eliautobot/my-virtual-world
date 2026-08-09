/*
 * My Virtual World provider-neutral chat event model.
 *
 * Providers translate their native streams into the small event vocabulary
 * below. The reducer owns ordering and run lifecycle; the DOM renderer only
 * applies the returned actions. Keeping this file free of browser APIs makes
 * the exact same behavior replayable in Node regression tests.
 */
(function initChatEvents(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChatEvents = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function chatEventsFactory() {
  'use strict';

  const TERMINAL_KINDS = new Set(['run.complete', 'run.failed', 'run.cancelled']);

  function asText(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function timestampMs(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value <= 0) return 0;
      return value > 1e12 ? value : value * 1000;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric > 1e12 ? numeric : numeric * 1000;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function toolIdentity(tool) {
    if (!tool || typeof tool !== 'object') return '';
    const id = tool.id || tool.toolCallId || tool.callId || '';
    if (id) return `id:${id}`;
    const args = tool.arguments || tool.args || tool.input || {};
    const preview = args && typeof args === 'object'
      ? (args.command || args.path || args.file_path || args.url || args.query || args.message || args.value || '')
      : args;
    return [tool.runId || '', tool.name || tool.toolName || 'tool', String(preview).slice(0, 180)].join('|');
  }

  function mergeTool(target, update) {
    if (!target) return { ...(update || {}) };
    if (!update) return target;
    if (update.name && (!target.name || target.name === 'tool' || target.name === 'tool result')) target.name = update.name;
    if (update.arguments && Object.keys(update.arguments).length) target.arguments = update.arguments;
    if (update.result !== undefined && update.result !== '') target.result = update.result;
    if (update.error) target.error = update.error;
    if (update.status) target.status = update.status;
    if (update.runId) target.runId = update.runId;
    return target;
  }

  function mergeHistoryItems(items) {
    const prepared = (Array.isArray(items) ? items : []).map((item, index) => ({
      ...item,
      _inputIndex: index,
      _timeMs: timestampMs(item.epochMs || item.ts || item.timestamp)
    }));
    prepared.sort((a, b) => {
      if (a._timeMs && b._timeMs && a._timeMs !== b._timeMs) return a._timeMs - b._timeMs;
      if (a._timeMs && !b._timeMs) return -1;
      if (!a._timeMs && b._timeMs) return 1;
      return a._inputIndex - b._inputIndex;
    });

    const toolOwners = new Map();
    for (const item of prepared) {
      const kept = [];
      for (const rawTool of (Array.isArray(item.tools) ? item.tools : [])) {
        const tool = { ...rawTool };
        const key = toolIdentity(tool);
        const owner = key ? toolOwners.get(key) : null;
        if (owner) {
          mergeTool(owner, tool);
          continue;
        }
        kept.push(tool);
        if (key) toolOwners.set(key, tool);
      }
      item.tools = kept;
    }

    return prepared
      .filter((item) => asText(item.text).trim() || item.media?.length || item.thinking || item.approval || item.tools.length)
      .map(({ _inputIndex, _timeMs, ...item }) => item);
  }

  class TurnEventReducer {
    constructor() {
      this.runs = new Map();
    }

    reset(runId) {
      if (runId) this.runs.delete(String(runId));
      else this.runs.clear();
    }

    get(runId) {
      return this.runs.get(String(runId || 'run')) || null;
    }

    _ensure(runId) {
      const key = String(runId || 'run');
      let run = this.runs.get(key);
      if (!run) {
        run = {
          runId: key,
          status: 'idle',
          fullText: '',
          committedText: '',
          segmentText: '',
          segmentTs: 0,
          segmentOpen: false,
          afterBoundary: false,
          thinkingText: '',
          lastFinalizedText: '',
          tools: new Map(),
          terminal: false
        };
        this.runs.set(key, run);
      }
      return run;
    }

    _freezeText(run, actions) {
      const text = asText(run.segmentText);
      if (run.segmentOpen && text.trim()) {
        actions.push({ kind: 'text.finalize', runId: run.runId, text, ts: run.segmentTs || 0 });
        run.lastFinalizedText = text;
      } else if (run.segmentOpen) {
        actions.push({ kind: 'text.discard', runId: run.runId });
      }
      run.committedText = run.fullText;
      run.segmentText = '';
      run.segmentTs = 0;
      run.segmentOpen = false;
      run.afterBoundary = true;
    }

    _applyText(run, event, actions) {
      const incoming = asText(event.text);
      const eventTs = timestampMs(event.epochMs || event.ts || event.timestamp);
      if (event.kind === 'text.replace' && run.terminal && !run.segmentOpen) {
        const previousSegment = asText(run.lastFinalizedText);
        if (previousSegment && incoming === previousSegment) return;
        if (previousSegment && incoming.startsWith(previousSegment)) {
          const priorPrefix = run.fullText.endsWith(previousSegment)
            ? run.fullText.slice(0, -previousSegment.length)
            : '';
          run.fullText = priorPrefix + incoming;
          run.committedText = run.fullText;
          run.lastFinalizedText = incoming;
          actions.push({ kind: 'text.amend', runId: run.runId, text: incoming });
          return;
        }
        if (run.fullText && incoming === run.fullText) return;
        if (run.fullText && incoming.startsWith(run.fullText) && previousSegment) {
          const suffix = incoming.slice(run.fullText.length);
          run.fullText = incoming;
          run.committedText = incoming;
          run.lastFinalizedText = previousSegment + suffix;
          actions.push({ kind: 'text.amend', runId: run.runId, text: run.lastFinalizedText });
          return;
        }
      }
      if (event.kind === 'text.delta') {
        run.fullText += incoming;
      } else if (!run.fullText || incoming.startsWith(run.fullText)) {
        run.fullText = incoming;
      } else if (run.fullText.startsWith(incoming)) {
        // Ignore a stale/shorter cumulative snapshot.
      } else if (run.afterBoundary && run.committedText && !incoming.startsWith(run.committedText)) {
        // Some providers restart text after a tool instead of sending a
        // cumulative reply. Treat that as the next segment.
        run.fullText = run.committedText + incoming;
      } else {
        run.fullText = incoming;
        if (!incoming.startsWith(run.committedText)) run.committedText = '';
      }

      let segment = run.fullText;
      if (run.committedText && run.fullText.startsWith(run.committedText)) {
        segment = run.fullText.slice(run.committedText.length);
      }
      run.segmentText = segment;
      if (!run.segmentOpen && eventTs) run.segmentTs = eventTs;
      run.afterBoundary = false;
      run.terminal = false;
      run.status = 'running';
      if (!segment && !run.segmentOpen) return;
      actions.push({
        kind: run.segmentOpen ? 'text.update' : 'text.open',
        runId: run.runId,
        text: segment,
        ts: run.segmentTs || eventTs || 0
      });
      run.segmentOpen = true;
    }

    _toolAction(run, event, actions) {
      const tool = { ...(event.tool || {}) };
      const key = event.toolKey || toolIdentity(tool) || `${run.runId}:tool:${run.tools.size + 1}`;
      tool.key = key;
      tool.runId = tool.runId || run.runId;
      let existing = run.tools.get(key);
      const previous = existing ? {
        status: existing.status,
        result: existing.result,
        error: existing.error
      } : null;

      if (!existing) {
        this._freezeText(run, actions);
        existing = { ...tool, status: 'running' };
        run.tools.set(key, existing);
        actions.push({ kind: 'tool.start', runId: run.runId, tool: { ...existing } });
      } else if (existing.status !== 'running' && event.kind !== 'tool.result') {
        return;
      }

      mergeTool(existing, tool);
      if (event.kind === 'tool.start') return;
      if (event.kind === 'tool.update') {
        existing.status = 'running';
        actions.push({ kind: 'tool.update', runId: run.runId, tool: { ...existing } });
        return;
      }
      existing.status = tool.error || event.error ? 'error' : (tool.status || 'done');
      if (existing.status === 'running') existing.status = 'done';
      if (
        previous &&
        previous.status !== 'running' &&
        previous.status === existing.status &&
        previous.result === existing.result &&
        previous.error === existing.error
      ) return;
      actions.push({ kind: 'tool.result', runId: run.runId, tool: { ...existing } });
    }

    ingest(event) {
      if (!event || !event.kind) return [];
      const run = this._ensure(event.runId);
      const actions = [];

      if (event.kind === 'run.start') {
        run.status = 'running';
        run.terminal = false;
        actions.push({ kind: 'run.start', runId: run.runId, label: event.label || '' });
        return actions;
      }

      if (event.kind === 'text.delta' || event.kind === 'text.replace') {
        this._applyText(run, event, actions);
        return actions;
      }

      if (event.kind === 'commentary') {
        const text = asText(event.text);
        if (!text.trim()) return actions;
        if (run.segmentOpen) this._freezeText(run, actions);
        this._applyText(run, { kind: 'text.delta', text, ts: event.ts || event.epochMs || event.timestamp }, actions);
        this._freezeText(run, actions);
        return actions;
      }

      if (event.kind === 'thinking') {
        if (run.segmentOpen) this._freezeText(run, actions);
        const text = asText(event.text).trim();
        if (text) {
          run.thinkingText = text;
          actions.push({ kind: 'thinking', runId: run.runId, text });
        }
        return actions;
      }

      if (event.kind === 'tool.start' || event.kind === 'tool.update' || event.kind === 'tool.result') {
        this._toolAction(run, event, actions);
        return actions;
      }

      if (event.kind === 'approval') {
        if (run.segmentOpen) this._freezeText(run, actions);
        actions.push({ kind: 'approval', runId: run.runId, approval: event.approval, provider: event.provider || '' });
        return actions;
      }

      if (TERMINAL_KINDS.has(event.kind)) {
        if (run.segmentOpen) this._freezeText(run, actions);
        const status = event.kind === 'run.complete' ? 'completed' : (event.kind === 'run.cancelled' ? 'cancelled' : 'failed');
        for (const tool of run.tools.values()) {
          if (tool.status !== 'running') continue;
          tool.status = status === 'failed' ? 'error' : 'done';
          if (!tool.result && !tool.error) {
            if (status === 'cancelled') tool.result = 'Cancelled';
            else if (status === 'failed') tool.error = event.error || 'Run failed';
            else tool.result = 'Completed';
          }
          actions.push({ kind: 'tool.result', runId: run.runId, tool: { ...tool } });
        }
        run.status = status;
        run.terminal = true;
        actions.push({ kind: 'run.terminal', runId: run.runId, status, error: event.error || '' });
        return actions;
      }

      return actions;
    }
  }

  return {
    TurnEventReducer,
    mergeHistoryItems,
    timestampMs,
    toolIdentity
  };
});
