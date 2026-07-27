// Shared OpenClaw run-event decisions for the chat client and regression tests.
(() => {
  const TERMINAL_ERROR_STATES = new Set(['error', 'failed', 'failure', 'cancelled', 'canceled']);
  const EXPLICIT_RUN_ERROR_TYPES = new Set(['run_error', 'run.failed']);

  function normalizeEventValue(value) {
    return String(value || '').trim().toLowerCase();
  }

  function getRunId(payload, fallbackRunId = '') {
    const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
    return String(payload?.runId || payload?.clientRunId || data.runId || fallbackRunId || '');
  }

  function isTerminalErrorState(state) {
    return TERMINAL_ERROR_STATES.has(normalizeEventValue(state));
  }

  function classifyChatEvent(payload) {
    const state = normalizeEventValue(payload?.state);
    if (isTerminalErrorState(state) || payload?.ok === false) return 'terminal-error';
    if (state === 'final' || state === 'done') return 'success';
    if (state === 'delta' || state === 'streaming') return 'streaming';
    return 'other';
  }

  function classifyAgentEvent(payload) {
    const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
    const stream = normalizeEventValue(payload?.stream || data.stream);
    const phase = normalizeEventValue(data.phase || payload?.phase);
    const eventType = normalizeEventValue(payload?.type || data.type);
    const isToolLikeItem = stream === 'item' && data.kind === 'command';
    const isToolEvent = stream === 'tool'
      || isToolLikeItem
      || eventType === 'tool_start'
      || eventType === 'tool_end'
      || eventType === 'tool_result';

    if (isToolEvent) return 'tool';
    // Agent events can report a failed command as run.failed even when the
    // model recovers and later produces a successful final chat event.
    // Keep all agent-side errors pending until the chat stream resolves them.
    if (EXPLICIT_RUN_ERROR_TYPES.has(eventType)) return 'pending-error';
    if ((stream === 'lifecycle' && isTerminalErrorState(phase)) || eventType === 'error') return 'pending-error';
    if (eventType === 'thinking' || (stream === 'lifecycle' && phase === 'start')) return 'thinking';
    return 'other';
  }

  function isHistoricalToolError(block, message = {}) {
    return Boolean(block?.error)
      || block?.isError === true
      || Boolean(message?.error)
      || message?.isError === true;
  }

  function classifyFailureStatus(message, payload = {}) {
    const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
    const nestedPayload = payload?.payload && typeof payload.payload === 'object' ? payload.payload : {};
    const details = [
      message,
      payload?.type,
      payload?.state,
      payload?.error?.code,
      payload?.error?.type,
      data.type,
      data.code,
      data.error?.code,
      data.error?.type,
      data.provider,
      data.model,
      data.providerErrorMessagePreview,
      nestedPayload.error?.code,
      nestedPayload.error?.type,
      nestedPayload.provider,
      nestedPayload.model
    ].filter(Boolean).join(' ');

    if (
      /\b(model|provider|anthropic|openai|gemini|google ai|ollama)\b/i.test(details)
      || /\b(api[ -]?key|authentication|unauthorized|rate[ -]?limit|quota|context[ -]?window|token limit)\b/i.test(details)
    ) {
      return 'Model/provider error';
    }
    if (/\b(gateway|websocket|socket|transport|connection|not connected|rpc|timed? out|timeout)\b/i.test(details)) {
      return 'OpenClaw error';
    }
    return 'Run failed';
  }

  class OpenClawRunTracker {
    constructor() {
      this.pendingErrors = new Map();
      this.terminalStates = new Map();
      this.maxTerminalStates = 100;
    }

    notePending(payload, fallbackRunId = '') {
      const runId = getRunId(payload, fallbackRunId);
      if (runId && !this.isSucceeded(runId)) this.pendingErrors.set(runId, payload);
      return runId;
    }

    consumePending(payloadOrRunId, fallbackRunId = '') {
      const runId = typeof payloadOrRunId === 'string'
        ? payloadOrRunId
        : getRunId(payloadOrRunId, fallbackRunId);
      if (!runId) return null;
      const pending = this.pendingErrors.get(runId) || null;
      this.pendingErrors.delete(runId);
      return pending;
    }

    clear(payloadOrRunId, fallbackRunId = '') {
      const runId = typeof payloadOrRunId === 'string'
        ? payloadOrRunId
        : getRunId(payloadOrRunId, fallbackRunId);
      if (runId) this.pendingErrors.delete(runId);
    }

    stateOf(payloadOrRunId, fallbackRunId = '') {
      const runId = typeof payloadOrRunId === 'string'
        ? payloadOrRunId
        : getRunId(payloadOrRunId, fallbackRunId);
      return runId ? (this.terminalStates.get(runId) || '') : '';
    }

    isSucceeded(payloadOrRunId, fallbackRunId = '') {
      return this.stateOf(payloadOrRunId, fallbackRunId) === 'succeeded';
    }

    markSucceeded(payloadOrRunId, fallbackRunId = '') {
      const runId = typeof payloadOrRunId === 'string'
        ? payloadOrRunId
        : getRunId(payloadOrRunId, fallbackRunId);
      if (!runId) return false;
      this.pendingErrors.delete(runId);
      this.rememberTerminal(runId, 'succeeded');
      return true;
    }

    markFailed(payloadOrRunId, fallbackRunId = '') {
      const runId = typeof payloadOrRunId === 'string'
        ? payloadOrRunId
        : getRunId(payloadOrRunId, fallbackRunId);
      if (!runId) return true;
      const state = this.stateOf(runId);
      if (state === 'succeeded' || state === 'failed') return false;
      this.pendingErrors.delete(runId);
      this.rememberTerminal(runId, 'failed');
      return true;
    }

    rememberTerminal(runId, state) {
      this.terminalStates.delete(runId);
      this.terminalStates.set(runId, state);
      while (this.terminalStates.size > this.maxTerminalStates) {
        this.terminalStates.delete(this.terminalStates.keys().next().value);
      }
    }

    reset() {
      this.pendingErrors.clear();
      this.terminalStates.clear();
    }
  }

  globalThis.VirtualWorldOpenClawRunState = Object.freeze({
    OpenClawRunTracker,
    classifyAgentEvent,
    classifyChatEvent,
    classifyFailureStatus,
    getRunId,
    isHistoricalToolError,
    isTerminalErrorState
  });
})();
