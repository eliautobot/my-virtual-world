// Virtual World Chat — Gateway WebSocket Client (Multi-Window, ported from Virtual Office)
(() => {
  const {
    OpenClawRunTracker,
    classifyAgentEvent,
    classifyChatEvent,
    classifyFailureStatus,
    getRunId: getOpenClawRunId,
    isHistoricalToolError
  } = globalThis.VirtualWorldOpenClawRunState;
  const {
    escapeHtml: escHtml,
    renderMarkdown: formatContent
  } = globalThis.VirtualWorldChatMarkdown;
  let GATEWAY_TOKEN = '';
  let GATEWAY_URL = '';
  let GATEWAY_TRANSPORT = 'proxy';
  let GATEWAY_RPC_URL = '/api/openclaw/rpc';
  let GATEWAY_EVENTS_URL = '/api/openclaw/events';
  let ws = null;
  let gatewayEvents = null;
  let reqId = 0;
  let connected = false;
  let pendingCallbacks = {};
  let _chatWsPort = null;
  let GATEWAY_CLIENT_VERSION = 'unknown';
  let _modelBarInterval = null;
  let gatewayAuthFailed = false;
  let gatewayAuthFailureMessage = '';
  let lastGatewayToken = null;
  let toolCallsExpandedByDefault = true;
  const runOwners = new Map();
  const LOCAL_GATEWAY_HOSTS = new Set(['127.0.0.1', 'localhost', '0.0.0.0', 'host.docker.internal']);

  async function loadGatewayInfo() {
    try {
      const r = await fetch('/gateway-info', { cache: 'no-store' });
      const d = await r.json();
      if (d.wsPort) _chatWsPort = d.wsPort;
      GATEWAY_URL = typeof d.gatewayUrl === 'string' ? d.gatewayUrl.trim() : '';
      GATEWAY_TRANSPORT = d.transport === 'direct' ? 'direct' : 'proxy';
      GATEWAY_RPC_URL = typeof d.rpcUrl === 'string' && d.rpcUrl ? d.rpcUrl : '/api/openclaw/rpc';
      GATEWAY_EVENTS_URL = typeof d.eventsUrl === 'string' && d.eventsUrl ? d.eventsUrl : '/api/openclaw/events';
      const nextToken = typeof d.token === 'string' ? d.token : '';
      if (nextToken !== lastGatewayToken) {
        gatewayAuthFailed = false;
        gatewayAuthFailureMessage = '';
        lastGatewayToken = nextToken;
      }
      GATEWAY_TOKEN = nextToken;
      if (d.openclawVersion) GATEWAY_CLIENT_VERSION = d.openclawVersion;
      return d;
    } catch (err) {
      console.warn('[chat] Failed to load gateway info:', err);
      return null;
    }
  }

  function applyChatUiSettings(config, { applyExisting = false } = {}) {
    const nextExpanded = config?.chat?.toolCallsExpanded !== false;
    const changed = nextExpanded !== toolCallsExpandedByDefault;
    toolCallsExpandedByDefault = nextExpanded;
    if (applyExisting && changed) {
      document.querySelectorAll('.chat-tool-call').forEach((card) => {
        card.open = toolCallsExpandedByDefault;
      });
    }
  }

  async function loadChatUiSettings() {
    try {
      const response = await fetch('/vw-config', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const config = await response.json();
      applyChatUiSettings(config);
      return config;
    } catch (err) {
      console.warn('[chat] Failed to load chat display settings:', err);
      return null;
    }
  }

  const gatewayInfoReady = loadGatewayInfo();
  const chatUiSettingsReady = loadChatUiSettings();

  const MAX_INPUT_LINES = 15;
  const TOOL_RENDER_INTERVAL_MS = 80;
  const STREAMING_TEXT_RENDER_INTERVAL_MS = 50;
  const MAX_LIVE_TOOL_CARDS = 24;
  const CHAT_STACK_GAP = 12;
  const CHAT_BOTTOM_OFFSET = 36;
  const CHAT_BOTTOM_FOLLOW_THRESHOLD = 28;
  const CHAT_BOTTOM_REATTACH_THRESHOLD = 2;
  const CHAT_MANUAL_SCROLL_INTENT_MS = 180;
  const CHAT_MIDDLE_SCROLL_DEAD_ZONE = 8;
  const CHAT_MIDDLE_SCROLL_MAX_SPEED = 26;
  const HERMES_APPROVAL_POLL_MS = 1500;
  const NATIVE_PROVIDER_UI = Object.freeze({
    hermes: {
      label: 'Hermes',
      path: 'hermes',
      sourceProperty: 'hermesEventSource',
      completedKeysProperty: 'hermesCompletedToolKeys',
      approval: 'hermes'
    },
    codex: {
      label: 'Codex',
      path: 'codex',
      sourceProperty: 'codexEventSource',
      completedKeysProperty: 'codexCompletedToolKeys',
      approval: 'codex'
    }
  });
  const CHAT_SELECTION_STORAGE_KEY = 'vw-chat-selection-v1';
  const DEFAULT_CHAT_AGENT_KEY = 'main';
  const DEFAULT_CHAT_SESSION_KEY = 'agent:main:main';
  let activeMiddleScrollWindow = null;
  const secondarySlotButtons = Array.from(document.querySelectorAll('[data-chat-slot-toggle]'));
  let activeSecondarySlot = null;
  const secondaryPanelPlaceholders = {
    1: document.getElementById('chat-secondary-1'),
    2: document.getElementById('chat-secondary-2'),
    3: document.getElementById('chat-secondary-3')
  };
  let secondaryChatPanels = {};
  let chatVisualViewportBaselineHeight = Math.max(
    window.innerHeight || 0,
    document.documentElement?.clientHeight || 0
  );

  function syncChatVisualViewport() {
    const visualViewport = window.visualViewport;
    const viewportHeight = Math.max(1, Number(visualViewport?.height || window.innerHeight || 1));
    const viewportTop = Math.max(0, Number(visualViewport?.offsetTop || 0));
    const layoutHeight = Math.max(
      viewportHeight + viewportTop,
      Number(window.innerHeight || 0),
      Number(document.documentElement?.clientHeight || 0)
    );
    const activeElement = document.activeElement;
    const chatInputFocused = Boolean(activeElement?.matches?.('.chat-panel .chat-input'));
    if (!chatInputFocused) chatVisualViewportBaselineHeight = layoutHeight;
    else chatVisualViewportBaselineHeight = Math.max(chatVisualViewportBaselineHeight, layoutHeight);
    const keyboardInset = chatInputFocused
      ? Math.max(0, layoutHeight - viewportTop - viewportHeight)
      : 0;
    const keyboardOpen = chatInputFocused && (
      keyboardInset >= 80 || viewportHeight <= chatVisualViewportBaselineHeight * 0.78
    );
    const root = document.documentElement;
    root.style.setProperty('--chat-visual-viewport-height', `${Math.round(viewportHeight)}px`);
    root.style.setProperty('--chat-visual-viewport-offset-top', `${Math.round(viewportTop)}px`);
    root.style.setProperty('--chat-keyboard-inset', `${Math.round(keyboardInset)}px`);
    root.classList.toggle('chat-keyboard-open', keyboardOpen);
    return {
      viewportHeight,
      viewportTop,
      layoutHeight,
      baselineHeight: chatVisualViewportBaselineHeight,
      keyboardInset,
      keyboardOpen
    };
  }

  function scheduleChatVisualViewportSync() {
    syncChatVisualViewport();
    requestAnimationFrame(syncChatVisualViewport);
    setTimeout(syncChatVisualViewport, 80);
    setTimeout(syncChatVisualViewport, 280);
  }

  syncChatVisualViewport();
  window.visualViewport?.addEventListener('resize', syncChatVisualViewport, { passive: true });
  window.visualViewport?.addEventListener('scroll', syncChatVisualViewport, { passive: true });
  window.addEventListener('resize', syncChatVisualViewport, { passive: true });
  document.addEventListener('focusin', event => {
    if (event.target?.matches?.('.chat-panel .chat-input')) scheduleChatVisualViewportSync();
  });
  document.addEventListener('focusout', event => {
    if (event.target?.matches?.('.chat-panel .chat-input')) setTimeout(syncChatVisualViewport, 80);
  });
  window.__getChatVisualViewportState = syncChatVisualViewport;

  function readSavedChatSelections() {
    try {
      const saved = JSON.parse(localStorage.getItem(CHAT_SELECTION_STORAGE_KEY) || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch (e) {
      return {};
    }
  }

  function getSavedChatSelection(slotId) {
    const saved = readSavedChatSelections()[slotId];
    if (!saved || typeof saved !== 'object') return null;
    if (!saved.selectedAgentKey || !saved.sessionKey) return null;
    return saved;
  }

  function saveChatSelection(slotId, selection) {
    if (!slotId || !selection?.selectedAgentKey || !selection?.sessionKey) return;
    try {
      const saved = readSavedChatSelections();
      saved[slotId] = {
        selectedAgentKey: selection.selectedAgentKey,
        sessionKey: selection.sessionKey
      };
      localStorage.setItem(CHAT_SELECTION_STORAGE_KEY, JSON.stringify(saved));
    } catch (e) {
      console.warn('[chat] Failed to save chat selection:', e);
    }
  }

  function formatSessionTimestamp(value) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed || trimmed.toLowerCase() === 'undefined' || trimmed.toLowerCase() === 'null') return '';
      const parsed = new Date(trimmed);
      if (Number.isNaN(parsed.getTime())) return trimmed.length > 28 ? trimmed.slice(0, 28) : trimmed;
      return parsed.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return '';
    const date = new Date(numeric > 1e12 ? numeric : numeric * 1000);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function titleCaseAgentKey(agentKey) {
    const raw = String(agentKey || '').trim();
    if (!raw) return 'Saved chat';
    return raw
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  class ChatWindow {
    constructor(root, options = {}) {
      this.root = root;
      this.isPrimary = !!options.isPrimary;
      this.slot = options.slot || null;
      this.slotId = this.isPrimary ? 'primary' : `secondary-${this.slot}`;
      this.root.dataset.chatSlot = this.slotId;
      const savedSelection = getSavedChatSelection(this.slotId);
      this.agentList = [];
      this.selectedAgentKey = options.selectedAgentKey || savedSelection?.selectedAgentKey || DEFAULT_CHAT_AGENT_KEY;
      this.sessionKey = options.sessionKey || savedSelection?.sessionKey || DEFAULT_CHAT_SESSION_KEY;
      this.hasExplicitAgentSelection = !!savedSelection || !!options.selectedAgentKey || !!options.sessionKey;
      this.currentRunId = null;
      this.turnEvents = new ChatEvents.TurnEventReducer();
      this.openClawEventQueue = Promise.resolve();
      this.seenOpenClawCommentary = new Set();
      this.streamingMsg = null;
      this.openClawRunTracker = new OpenClawRunTracker();
      this.liveToolCards = new Map();
      this.pendingToolEvents = new Map();
      this.toolFlushTimer = null;
      this.hermesProgressTimers = [];
      this.hermesLivePollTimer = null;
      this.hermesLiveEventSeq = 0;
      this.hermesEventSource = null;
      this.codexEventSource = null;
      this.providerEventSource = null;
      this.hermesCompletedToolKeys = new Set();
      this.codexCompletedToolKeys = new Set();
      this.liveThinkingEl = null;
      this.liveThinkingPre = null;
      this.liveThinkingRunId = '';
      this.hermesApprovalPollTimer = null;
      this.hermesApprovalLastId = '';
      this.codexApprovalPollTimer = null;
      this.codexApprovalLastId = '';
      this.scrollFrame = null;
      this.scrollSettleFrame = null;
      this.scrollSettleTimer = null;
      this.followLatest = true;
      this.scrollTrackingSuspended = false;
      this.manualScrollIntentUntil = 0;
      this.manualScrollBottomTarget = 0;
      this.manualScrollDirection = 0;
      this.lastMessagesScrollTop = 0;
      this.lastTouchScrollY = null;
      this.scrollbarPointerDown = false;
      this.middleScrollActive = false;
      this.middleScrollPointerDown = false;
      this.middleScrollGestureMoved = false;
      this.middleScrollAnchorX = 0;
      this.middleScrollAnchorY = 0;
      this.middleScrollPointerX = 0;
      this.middleScrollPointerY = 0;
      this.middleScrollFrame = null;
      this.inputResizeFrame = null;
      this.streamingRenderTimer = null;
      this.streamingPendingContent = '';
      this.streamingRenderedContent = '';
      this.lastLiveEventAt = 0;
      this.liveAttentionByRunId = new Map();
      this.pendingLiveAttentionAgentId = '';
      this.sessionModel = '—';
      this.contextWindow = 0;
      this.contextUsed = 0;
      this.pendingAttachments = [];
      this.isRecording = false;
      this.mediaRecorder = null;
      this.audioChunks = [];

      this.messages = root.querySelector('.chat-messages');
      this.scrollLatestBtn = root.querySelector('.chat-scroll-latest');
      this.middleScrollOrigin = root.querySelector('.chat-middle-scroll-origin');
      this.status = root.querySelector('.chat-status');
      this.runNotice = root.querySelector('.chat-run-notice');
      this.runNoticeTitle = root.querySelector('.chat-run-notice-title');
      this.runNoticeMessage = root.querySelector('.chat-run-notice-message');
      this.runNoticeDismiss = root.querySelector('.chat-run-notice-dismiss');
      this.agentSelect = root.querySelector('.chat-agent-select');
      this.modelName = root.querySelector('.chat-model-name, #chat-model-name');
      this.contextInfo = root.querySelector('.chat-context-info, #chat-context-info');
      this.input = root.querySelector('.chat-input');
      this.sendBtn = root.querySelector('.chat-send-btn');
      this.stopBtn = root.querySelector('.chat-stop-btn');
      this.attachBtn = root.querySelector('.chat-attach-btn');
      this.fileInput = root.querySelector('.chat-file-input');
      this.attachmentsPreview = root.querySelector('.chat-attachments-preview');
      this.micBtn = root.querySelector('.chat-mic-btn');
      this.newSessionBtn = root.querySelector('.chat-new-session');
      this.closeBtn = root.querySelector('.chat-close, .chat-secondary-close');
      this.sessionsToggleBtn = root.querySelector('.chat-sessions-toggle');
      this.sessionsPanel = root.querySelector('.chat-sessions-panel');
      this.sessionsListEl = root.querySelector('.chat-sessions-list');
      this.sessionsNewBtn = root.querySelector('.chat-sessions-new');
      this.sessionsPanelOpen = false;
      this.sessionsRefreshTimer = null;
      this.liveSessionRefreshTimer = null;
      this.liveResponsePendingAt = 0;
      this.sessionsRefreshSeq = 0;
      this.currentSessions = [];

      this.messages.addEventListener('click', (e) => {
        if (e.target.classList.contains('chat-image-clickable') || e.target.classList.contains('chat-image-thumb')) {
          openImageLightbox(e.target.src);
        }
      });
      this.messages.addEventListener('scroll', () => this.handleMessagesScroll(), { passive: true });
      this.messages.addEventListener('wheel', (event) => {
        this.noteManualScrollIntent(Math.sign(event.deltaY));
      }, { passive: true });
      this.messages.addEventListener('touchstart', (event) => {
        this.lastTouchScrollY = event.touches?.[0]?.clientY ?? null;
      }, { passive: true });
      this.messages.addEventListener('touchmove', (event) => {
        const nextY = event.touches?.[0]?.clientY ?? this.lastTouchScrollY;
        const direction = this.lastTouchScrollY == null || nextY == null
          ? 0
          : Math.sign(this.lastTouchScrollY - nextY);
        this.lastTouchScrollY = nextY;
        this.noteManualScrollIntent(direction);
      }, { passive: true });
      this.messages.addEventListener('touchend', () => { this.lastTouchScrollY = null; }, { passive: true });
      this.messages.addEventListener('touchcancel', () => { this.lastTouchScrollY = null; }, { passive: true });
      this.messages.addEventListener('pointerdown', (e) => {
        const rect = this.messages.getBoundingClientRect();
        const scrollbarWidth = Math.max(0, this.messages.offsetWidth - this.messages.clientWidth);
        this.scrollbarPointerDown = scrollbarWidth > 0 && e.clientX >= rect.right - scrollbarWidth - 2;
        if (this.scrollbarPointerDown) this.noteManualScrollIntent();
      }, { passive: true });
      window.addEventListener('pointermove', () => {
        if (this.scrollbarPointerDown) this.noteManualScrollIntent();
      }, { passive: true });
      const releaseScrollbarPointer = () => {
        this.scrollbarPointerDown = false;
      };
      window.addEventListener('pointerup', releaseScrollbarPointer, { passive: true });
      window.addEventListener('pointercancel', releaseScrollbarPointer, { passive: true });
      this.messages.addEventListener('mousedown', (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        if (this.middleScrollActive) {
          this.stopMiddleAutoScroll();
          return;
        }
        this.middleScrollPointerDown = true;
        this.middleScrollGestureMoved = false;
        this.startMiddleAutoScroll(e);
      });
      this.messages.addEventListener('auxclick', (e) => {
        if (e.button === 1) e.preventDefault();
      });
      this.scrollLatestBtn?.addEventListener('click', () => this.resumeLatest());
      window.addEventListener('mousemove', (e) => {
        if (!this.middleScrollActive) return;
        this.middleScrollPointerX = e.clientX;
        this.middleScrollPointerY = e.clientY;
        if (
          this.middleScrollPointerDown &&
          Math.hypot(
            this.middleScrollPointerX - this.middleScrollAnchorX,
            this.middleScrollPointerY - this.middleScrollAnchorY
          ) > CHAT_MIDDLE_SCROLL_DEAD_ZONE
        ) {
          this.middleScrollGestureMoved = true;
        }
      }, { passive: true });
      window.addEventListener('mouseup', (e) => {
        if (e.button !== 1 || !this.middleScrollPointerDown) return;
        this.middleScrollPointerDown = false;
        if (this.middleScrollGestureMoved) this.stopMiddleAutoScroll();
      });
      window.addEventListener('mousedown', (e) => {
        if (this.middleScrollActive && e.button !== 1) this.stopMiddleAutoScroll();
      }, true);
      window.addEventListener('keydown', (e) => {
        if (this.middleScrollActive && e.key === 'Escape') this.stopMiddleAutoScroll();
      });

      this.agentSelect?.addEventListener('change', () => {
        const opt = this.agentSelect.selectedOptions[0];
        if (!opt) return;
        this.applySelection(opt, { markExplicit: true, systemPrefix: 'Switched to' });
      });

      this.sendBtn?.addEventListener('click', () => this.sendMessage());
      this.stopBtn?.addEventListener('click', () => this.sendStop());
      this.runNoticeDismiss?.addEventListener('click', () => this.clearRunNotice());
      this.input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });
      this.input?.addEventListener('input', () => this.scheduleAutoResizeInput());
      this.input?.addEventListener('change', () => this.scheduleAutoResizeInput());
      this.input?.addEventListener('compositionend', () => this.scheduleAutoResizeInput());
      this.input?.addEventListener('paste', (e) => this.handlePaste(e));

      this.attachBtn?.addEventListener('click', () => this.fileInput?.click());
      this.fileInput?.addEventListener('change', () => this.handleFiles());
      this.micBtn?.addEventListener('click', () => this.toggleRecording());
      this.newSessionBtn?.addEventListener('click', () => this.newSession());
      this.sessionsToggleBtn?.addEventListener('click', () => this.toggleSessionsPanel());
      this.sessionsNewBtn?.addEventListener('click', () => this.createSessionFromPanel());
      this.closeBtn?.addEventListener('click', () => {
        if (this.isPrimary) {
          const chatPanel = document.getElementById('chat-panel');
          const chatBtn = document.getElementById('chat-toggle');
          // Clear snap/floating state and inline styles before closing
          chatPanel.classList.remove('open', 'floating', 'snap-left', 'snap-right', 'dragging', 'move-active');
          chatPanel.style.left = '';
          chatPanel.style.top = '';
          chatPanel.style.right = '';
          chatPanel.style.bottom = '';
          chatPanel.style.width = '';
          chatPanel.style.height = '';
          chatPanel.style.transform = '';
          chatBtn.style.display = 'flex';
          chatBtn.classList.remove('active');
          if (exteriorTabs) exteriorTabs.classList.remove('visible');
          closeAllSecondaryPanels();
          _chatExitMoveMode();
        } else if (this.slot) {
          _secExitMoveMode(this.slot);
          setSecondaryPanelOpen(this.slot, false);
        }
      });

      this.root.addEventListener('mousedown', () => {
        if (!this.isPrimary && this.slot) setActiveSecondarySlot(this.slot);
      });
      this.root.addEventListener('focusin', () => {
        if (!this.isPrimary && this.slot) setActiveSecondarySlot(this.slot);
      });
    }

    resetConversation(systemText) {
      this.stopMiddleAutoScroll();
      this.followLatest = true;
      this.clearManualScrollIntent();
      this.messages.innerHTML = '';
      this.streamingMsg = null;
      this.currentRunId = null;
      this.turnEvents.reset();
      this.openClawEventQueue = Promise.resolve();
      this.seenOpenClawCommentary.clear();
      this.openClawRunTracker.reset();
      this.clearRunNotice();
      this.liveAttentionByRunId.clear();
      this.pendingLiveAttentionAgentId = '';
      this.closeHermesEventSource();
      this.stopHermesLivePolling();
      this.cancelStreamingRender();
      if (this.toolFlushTimer) { clearTimeout(this.toolFlushTimer); this.toolFlushTimer = null; }
      this.pendingToolEvents.clear();
      this.liveToolCards.clear();
      this.liveThinkingEl = null;
      this.liveThinkingPre = null;
      this.liveThinkingRunId = '';
      this.sessionModel = '—';
      this.contextWindow = 0;
      this.contextUsed = 0;
      this.updateModelBar();
      if (systemText) this.appendSystem(systemText);
      else this.updateScrollLatestButton();
    }

    noteLiveAgentUserAttention(messagePreview = '') {
      if (window.__VWConfig?.features?.agentLiveMode !== true) return '';
      const agentId = this.getSelectedAgentId() || this.selectedAgentKey;
      if (!agentId) return '';
      try {
        fetch('/api/agent-live-loop/user-attention', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId,
            source: 'chat-window',
            holdSec: 180,
            mode: 'conversation',
            messagePreview: String(messagePreview || '').slice(0, 160)
          })
        }).catch(() => {});
      } catch (_) {}
      return String(agentId);
    }

    rememberLiveAttentionForRun(runId, agentId) {
      if (!runId || !agentId) return;
      this.liveAttentionByRunId.set(String(runId), String(agentId));
      this.pendingLiveAttentionAgentId = '';
    }

    settleLiveAgentUserAttention(agentId) {
      if (!agentId || window.__VWConfig?.features?.agentLiveMode !== true) return;
      try {
        fetch('/api/agent-live-loop/user-attention', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId,
            source: 'chat-window-response-settled',
            holdSec: 60,
            mode: 'conversation',
            messagePreview: 'Conversation response completed; wait for the user before resuming.'
          })
        }).catch(() => {});
      } catch (_) {}
    }

    clearLiveAttentionForRun(runId = '') {
      const key = String(runId || '');
      const agentId = (key && this.liveAttentionByRunId.get(key)) || this.pendingLiveAttentionAgentId || '';
      if (key) this.liveAttentionByRunId.delete(key);
      if (agentId && agentId === this.pendingLiveAttentionAgentId) this.pendingLiveAttentionAgentId = '';
      this.settleLiveAgentUserAttention(agentId);
    }

    setConnectionStatus(text, cls) {
      if (!this.status) return;
      this.status.textContent = text;
      this.status.className = 'chat-status ' + (cls || '');
    }

    showRunNotice(title, message, runId = '') {
      if (!this.runNotice) return;
      this.runNotice.dataset.runId = String(runId || '');
      if (this.runNoticeTitle) this.runNoticeTitle.textContent = title || 'Response not completed';
      if (this.runNoticeMessage) {
        const detail = String(message || 'The agent did not return a final response.');
        this.runNoticeMessage.textContent = detail;
        this.runNoticeMessage.title = detail;
      }
      this.runNotice.hidden = false;
    }

    clearRunNotice(runId = '') {
      if (!this.runNotice) return;
      if (runId && this.runNotice.dataset.runId && this.runNotice.dataset.runId !== String(runId)) return;
      this.runNotice.hidden = true;
      this.runNotice.dataset.runId = '';
      if (this.runNoticeMessage) {
        this.runNoticeMessage.textContent = '';
        this.runNoticeMessage.removeAttribute('title');
      }
    }

    formatTokens(n) {
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(0) + 'k';
      return String(n);
    }

    updateModelBar() {
      if (!this.modelName || !this.contextInfo) return;
      const shortModel = this.sessionModel.includes('/') ? this.sessionModel.split('/').pop() : this.sessionModel;
      this.modelName.textContent = shortModel;
      if (this.contextWindow > 0) {
        this.contextInfo.textContent = this.formatTokens(Math.max(0, this.contextUsed || 0)) + ' / ' + this.formatTokens(this.contextWindow);
      } else {
        this.contextInfo.textContent = '';
      }
    }

    scheduleAutoResizeInput() {
      if (!this.input || this.inputResizeFrame) return;
      this.inputResizeFrame = requestAnimationFrame(() => {
        this.inputResizeFrame = null;
        this.autoResizeInput();
      });
    }

    autoResizeInput() {
      if (!this.input) return;
      const styles = getComputedStyle(this.input);
      const fontSize = parseFloat(styles.fontSize) || 14;
      const lineHeight = (parseFloat(styles.lineHeight) || fontSize * 1.4);
      const inputMaxHeight = lineHeight * MAX_INPUT_LINES;
      this.input.style.setProperty('height', 'auto', 'important');
      const scrollHeight = this.input.scrollHeight;
      const newHeight = Math.min(scrollHeight, inputMaxHeight);
      this.input.style.setProperty('height', newHeight + 'px', 'important');
      this.input.style.overflowY = scrollHeight > inputMaxHeight ? 'auto' : 'hidden';
    }

    syncAgentSelect() {
      if (!this.agentSelect) return;
      const options = Array.from(this.agentSelect.querySelectorAll('option'));
      const exactMatch = options.find(opt => opt.value === this.selectedAgentKey && opt.dataset.sessionKey === this.sessionKey);
      if (exactMatch) {
        options.forEach(opt => { opt.selected = opt === exactMatch; });
        return;
      }
      const rosterMatch = options.find(opt => opt.value === this.selectedAgentKey)
        || options.find(opt => opt.dataset.agentId === this.selectedAgentKey)
        || options.find(opt => opt.dataset.providerAgentId === this.selectedAgentKey)
        || options.find(opt => opt.dataset.sessionKey === this.sessionKey);
      if (rosterMatch) {
        options.forEach(opt => { opt.selected = opt === rosterMatch; });
        this.selectedAgentKey = rosterMatch.value;
        const rosterSessionKey = rosterMatch.dataset.sessionKey || this.sessionKey;
        this.sessionKey = (this.sessionKey && this.sessionKey !== rosterSessionKey && rosterMatch.value === this.selectedAgentKey)
          ? this.sessionKey
          : rosterSessionKey;
        this.saveSelection();
        return;
      }
      if (!this.isDefaultSelection()) {
        this.ensurePreservedAgentOption();
        return;
      }
      const fallback = options[0];
      if (fallback) {
        fallback.selected = true;
        this.selectedAgentKey = fallback.value;
        this.sessionKey = fallback.dataset.sessionKey || this.sessionKey;
        this.saveSelection();
      }
    }

    isDefaultSelection() {
      return this.selectedAgentKey === DEFAULT_CHAT_AGENT_KEY && this.sessionKey === DEFAULT_CHAT_SESSION_KEY;
    }

    ensurePreservedAgentOption() {
      if (!this.agentSelect) return;
      this.agentSelect.querySelectorAll('[data-preserved-chat-selection="true"]').forEach(el => el.remove());
      const agentKey = this.selectedAgentKey || parseAgentIdFromSessionKey(this.sessionKey) || DEFAULT_CHAT_AGENT_KEY;
      const group = document.createElement('optgroup');
      group.label = 'Current chat';
      group.dataset.preservedChatSelection = 'true';
      const opt = document.createElement('option');
      opt.value = agentKey;
      opt.textContent = titleCaseAgentKey(agentKey);
      opt.dataset.sessionKey = this.sessionKey || `agent:${agentKey}:main`;
      opt.dataset.agentId = agentKey;
      opt.dataset.providerKind = String(this.sessionKey || '').startsWith('hermes:')
        ? 'hermes'
        : (String(this.sessionKey || '').startsWith('codex:') ? 'codex' : 'openclaw');
      opt.dataset.providerAgentId = agentKey;
      opt.dataset.preservedChatSelection = 'true';
      opt.selected = true;
      group.appendChild(opt);
      this.agentSelect.insertBefore(group, this.agentSelect.firstChild);
    }

    saveSelection() {
      saveChatSelection(this.slotId, {
        selectedAgentKey: this.selectedAgentKey,
        sessionKey: this.sessionKey
      });
    }

    applySelection(opt, { markExplicit = false, preserveForInheritance = markExplicit, systemPrefix = 'Switched to' } = {}) {
      if (!opt) return;
      const newSessionKey = opt.dataset.sessionKey;
      const newAgentKey = opt.value;
      if (newSessionKey === this.sessionKey && newAgentKey === this.selectedAgentKey) {
        if (markExplicit || preserveForInheritance) {
          this.hasExplicitAgentSelection = true;
          this.saveSelection();
        }
        this.syncCapabilityControls();
        return;
      }
      this.selectedAgentKey = newAgentKey;
      this.sessionKey = newSessionKey;
      if (markExplicit || preserveForInheritance) this.hasExplicitAgentSelection = true;
      this.saveSelection();
      this.closeHermesEventSource();
      this.closeCodexEventSource();
      this.closeProviderEventSource();
      this.currentRunId = null;
      this.streamingMsg = null;
      this.openClawRunTracker.reset();
      this.clearRunNotice();
      this.syncAgentSelect();
      this.syncCapabilityControls();
      this.resetConversation(`${systemPrefix} ${opt.textContent.trim()}`);
      if (this.sessionsPanelOpen) this.refreshSessionsList({ showLoading: true });
      if (this.isHermesSelected()) this.startHermesApprovalPolling();
      else this.stopHermesApprovalPolling();
      if (this.supportsProviderApprovals()) this.startCodexApprovalPolling();
      else this.stopCodexApprovalPolling();
      if (this.isLiveModeSessionSelected()) this.startLiveSessionPolling();
      else this.stopLiveSessionPolling();
      if (connected) {
        this.loadHistory();
        this.fetchSessionInfo();
      }
    }

    async loadAgentList() {
      try {
        const res = await fetch('/agents-list');
        const data = await res.json();
        if (!data.agents || !this.agentSelect) return;
        this.agentList = data.agents;
        this.agentSelect.innerHTML = '';
        const branches = {};
        for (const a of this.agentList) {
          if (!branches[a.branch]) branches[a.branch] = [];
          branches[a.branch].push(a);
        }
        for (const [branch, agents] of Object.entries(branches)) {
          const group = document.createElement('optgroup');
          group.label = branch;
          for (const a of agents) {
            const opt = document.createElement('option');
            opt.value = a.key;
            opt.textContent = `${a.emoji} ${a.name}${a.available === false ? ' (offline)' : ''}`;
            opt.dataset.sessionKey = a.sessionKey;
            opt.dataset.agentId = a.agentId;
            opt.dataset.providerKind = a.providerKind || 'openclaw';
            opt.dataset.providerAgentId = a.providerAgentId || a.agentId;
            opt.dataset.available = a.available === false ? 'false' : 'true';
            opt.dataset.connectionState = a.connectionState || (a.available === false ? 'offline' : 'connected');
            opt.dataset.capabilities = JSON.stringify(a.capabilities || {});
            opt.dataset.model = a.model || '';
            opt.dataset.provider = a.provider || '';
            group.appendChild(opt);
          }
          this.agentSelect.appendChild(group);
        }
        this.syncAgentSelect();
        this.syncCapabilityControls();
        if (this.sessionsPanelOpen) this.refreshSessionsList({ showLoading: true });
        if (connected && (this.isPrimary || this.root.classList.contains('open'))) {
          this.fetchSessionInfo();
          this.loadHistory();
        }
      } catch (e) {
        console.warn('[chat] Failed to load agent list:', e);
      }
    }

    isVisibleForPolling() {
      return this.isPrimary ? this.root.classList.contains('open') : this.root.classList.contains('open');
    }

    async fetchContextUsage() {
      if (!this.isVisibleForPolling()) return;
      try {
        // Avoid broad sessions.list polling. Describe only the selected session.
        const res = await rpc('sessions.describe', { key: this.sessionKey });
        const s = res?.payload?.session;
        if (!res.ok || !s) return;
        if (s.totalTokens > 0) this.contextUsed = s.totalTokens;
        if (s.contextTokens > 0 && s.contextTokens > this.contextWindow) this.contextWindow = s.contextTokens;
        // Don't update model from gateway transcript — it can be stale.
        // Model display is driven by fetchSessionInfo() from server config.
        this.updateModelBar();
      } catch (e) {
        console.warn('[chat] Failed to fetch context usage:', e);
      }
    }

    getSelectedAgentId() {
      if (!this.agentSelect) return null;
      const opt = this.agentSelect.selectedOptions[0];
      return opt?.dataset?.agentId || null;
    }

    getSelectedProviderKind() {
      const opt = this.agentSelect?.selectedOptions?.[0];
      return opt?.dataset?.providerKind || 'openclaw';
    }

    getSelectedCapabilities() {
      const opt = this.agentSelect?.selectedOptions?.[0];
      try { return JSON.parse(opt?.dataset?.capabilities || '{}') || {}; }
      catch (_) { return {}; }
    }

    isSelectedAgentAvailable() {
      const opt = this.agentSelect?.selectedOptions?.[0];
      return opt?.dataset?.available !== 'false';
    }

    syncCapabilityControls() {
      const capabilities = this.getSelectedCapabilities();
      const available = this.isSelectedAgentAvailable();
      if (this.input) this.input.disabled = !available;
      if (this.sendBtn) this.sendBtn.disabled = !available;
      syncWindowAvailabilityStatus(this);
      if (!Object.keys(capabilities).length) return;
      const toggle = (element, supported) => {
        if (!element) return;
        element.hidden = !supported;
        element.disabled = !supported;
        element.setAttribute('aria-hidden', supported ? 'false' : 'true');
      };
      toggle(this.sessionsToggleBtn, Boolean(capabilities.sessions));
      toggle(this.sessionsNewBtn, available && Boolean(capabilities.sessionCreate));
      toggle(this.newSessionBtn, available && Boolean(capabilities.sessionCreate));
      toggle(this.attachBtn, available && Boolean(capabilities.attachments));
      toggle(this.stopBtn, available && Boolean(capabilities.interrupt));
      if (!capabilities.sessions && this.sessionsPanelOpen) this.toggleSessionsPanel(false);
    }

    isHermesSelected() {
      const selectedAgentId = this.getSelectedAgentId() || this.selectedAgentKey || '';
      return (
        this.getSelectedProviderKind() === 'hermes'
        || String(this.sessionKey || '').startsWith('hermes:')
        || String(selectedAgentId).startsWith('hermes-')
      );
    }

    isCodexSelected() {
      return this.getSelectedProviderKind() === 'codex' || String(this.sessionKey || '').startsWith('codex:');
    }

    isGenericProviderSelected() {
      const kind = this.getSelectedProviderKind();
      return Boolean(kind && !['openclaw', 'hermes', 'codex'].includes(kind));
    }

    supportsProviderApprovals() {
      return this.getSelectedProviderKind() !== 'openclaw'
        && !this.isHermesSelected()
        && Boolean(this.getSelectedCapabilities().approvals);
    }

    isProviderAgentSelected() {
      return this.getSelectedProviderKind() !== 'openclaw' || this.isHermesSelected() || this.isCodexSelected();
    }

    isLiveModeSessionSelected(sessionKey = this.sessionKey) {
      const value = String(sessionKey || '');
      return value.startsWith('vw-live-mode:') || value.endsWith(':vw-live-mode-planner');
    }

    startLiveSessionPolling() {
      if (!this.isLiveModeSessionSelected() || this.liveSessionRefreshTimer) return;
      this.liveSessionRefreshTimer = setInterval(() => {
        if (!this.isLiveModeSessionSelected() || !this.isVisibleForPolling()) return;
        this.loadLiveModeSessionHistory().catch(error => console.warn('[chat] Live session refresh failed:', error));
      }, 1000);
    }

    stopLiveSessionPolling() {
      if (!this.liveSessionRefreshTimer) return;
      clearInterval(this.liveSessionRefreshTimer);
      this.liveSessionRefreshTimer = null;
    }

    startHermesApprovalPolling() {
      if (!this.isHermesSelected() || this.hermesApprovalPollTimer) return;
      this.pollHermesApproval().catch(() => {});
      this.hermesApprovalPollTimer = setInterval(() => {
        this.pollHermesApproval().catch(() => {});
      }, HERMES_APPROVAL_POLL_MS);
    }

    stopHermesApprovalPolling() {
      if (this.hermesApprovalPollTimer) {
        clearInterval(this.hermesApprovalPollTimer);
        this.hermesApprovalPollTimer = null;
      }
      this.hermesApprovalLastId = '';
    }

    async pollHermesApproval() {
      if (!this.isHermesSelected() || !this.isVisibleForPolling()) return;
      const agentId = this.getSelectedAgentId() || this.selectedAgentKey;
      const res = await fetch('/api/hermes/approval/pending?agentId=' + encodeURIComponent(agentId));
      const data = await res.json();
      if (!data.ok || !data.pending) return;
      this.appendHermesPendingApproval(data.pending, data.pending_count || 1);
    }

    startCodexApprovalPolling() {
      if (!this.supportsProviderApprovals() || this.codexApprovalPollTimer) return;
      this.pollCodexApproval().catch(() => {});
      this.codexApprovalPollTimer = setInterval(() => this.pollCodexApproval().catch(() => {}), HERMES_APPROVAL_POLL_MS);
    }

    stopCodexApprovalPolling() {
      if (this.codexApprovalPollTimer) clearInterval(this.codexApprovalPollTimer);
      this.codexApprovalPollTimer = null;
      this.codexApprovalLastId = '';
    }

    async pollCodexApproval() {
      if (!this.supportsProviderApprovals() || !this.isVisibleForPolling()) return;
      const agentId = this.getSelectedAgentId() || this.selectedAgentKey;
      const res = await fetch('/api/providers/approvals?agentId=' + encodeURIComponent(agentId));
      const data = await res.json();
      if (!data.ok || !data.pending) return;
      this.appendCodexPendingApproval(data.pending, data.pending_count || 1);
    }

    appendCodexPendingApproval(approval, pendingCount = 1) {
      if (!approval) return;
      const approvalId = approval.approval_id || approval.id || '';
      if (approvalId && [...this.messages.querySelectorAll('[data-approval-id]')].some(el => el.dataset.approvalId === approvalId)) return;
      const enriched = {
        ...approval,
        id: approvalId || approval.id,
        approval_id: approvalId || approval.approval_id,
        pending_count: pendingCount,
        providerKind: approval.providerKind || this.getSelectedProviderKind(),
        provider: approval.provider || this.getSelectedProviderKind()
      };
      this.codexApprovalLastId = enriched.id || '';
      this.appendMessage('assistant', '', Date.now(), [], { label:this.agentSelect.selectedOptions[0]?.textContent.trim() || 'Codex', kind:'agent', approval:enriched }, []);
      this.scrollBottom();
    }

    appendHermesPendingApproval(approval, pendingCount = 1) {
      if (!approval) return;
      const approvalId = approval.approval_id || approval.id || '';
      if (approvalId) {
        const existing = [...this.messages.querySelectorAll('[data-approval-id]')].find(el => el.dataset.approvalId === approvalId);
        if (existing) {
          this.updateHermesApprovalCard(existing, approval);
          return;
        }
      }
      const enriched = {
        ...approval,
        id: approvalId || approval.id,
        approval_id: approvalId || approval.approval_id,
        pending_count: pendingCount
      };
      this.hermesApprovalLastId = enriched.id || '';
      this.appendMessage(
        'assistant',
        '',
        Date.now(),
        [],
        {
          label: this.agentSelect.selectedOptions[0]?.textContent.trim() || 'Hermes',
          kind: 'agent',
          approval: enriched
        },
        []
      );
      this.scrollBottom();
    }

    updateHermesApprovalCard(card, approval) {
      if (!card || !approval) return;
      const status = String(approval.status || 'pending').toLowerCase();
      const visualStatus = status.includes('approved')
        ? 'approved'
        : (status.includes('denied') || status.includes('expired') || status.includes('timeout'))
          ? 'denied'
          : 'pending';
      card.classList.remove('pending', 'approved', 'denied', 'responding');
      card.classList.add(visualStatus);
      const icon = card.querySelector('.chat-approval-icon');
      if (icon) icon.textContent = visualStatus === 'approved' ? 'OK' : visualStatus === 'denied' ? 'x' : '!';
      const state = card.querySelector('.chat-approval-status');
      if (state) state.textContent = status === 'pending' ? 'pending' : status;
      if (visualStatus !== 'pending') {
        for (const button of card.querySelectorAll('button')) button.disabled = true;
      }
    }

    async fetchSessionInfo() {
      let gatewayContext = 0;
      if (!this.isProviderAgentSelected()) {
        try {
          // Targeted lookup avoids rebuilding the full sessions.list index.
          const res = await rpc('sessions.describe', { key: this.sessionKey });
          const s = res?.payload?.session;
          if (res.ok && s) {
            if (s.totalTokens > 0) this.contextUsed = s.totalTokens;
            if (s.contextTokens > 0) gatewayContext = s.contextTokens;
          }
        } catch (e) {
          console.warn('[chat] sessions.describe failed:', e);
        }
      }
      let serverContext = 0;
      try {
        // Pass current agent ID so server returns the correct configured model
        const agentId = this.getSelectedAgentId();
        const providerKind = this.getSelectedProviderKind();
        const params = new URLSearchParams();
        if (agentId) params.set('agent', agentId);
        if (providerKind) params.set('providerKind', providerKind);
        const qs = params.toString() ? `?${params.toString()}` : '';
        const res = await fetch('/session-info' + qs);
        const data = await res.json();
        // Always use the configured model from the server — this reflects
        // what the agent is SET to use, not what was last used historically.
        // The gateway transcript model can be stale (from before a model change).
        if (data.model) this.sessionModel = data.model;
        const contextUsed = Number(data.contextUsed);
        if (Number.isFinite(contextUsed) && contextUsed >= 0) this.contextUsed = contextUsed;
        if (data.contextWindow || data.codexContextWindow) serverContext = data.contextWindow || data.codexContextWindow;
      } catch (e) {
        console.warn('[chat] /session-info failed:', e);
      }
      this.contextWindow = Math.max(gatewayContext, serverContext);
      this.updateModelBar();
    }

    applyContextUsage(data = {}) {
      const contextUsed = Number(data.contextUsed);
      const contextWindow = Number(data.contextWindow || data.codexContextWindow);
      if (Number.isFinite(contextUsed) && contextUsed >= 0) this.contextUsed = contextUsed;
      if (Number.isFinite(contextWindow) && contextWindow > 0) this.contextWindow = contextWindow;
      this.updateModelBar();
    }

    renderHistoryItems(items) {
      this.replaceHistoryMessages(() => {
        this.liveThinkingEl = null;
        this.liveThinkingPre = null;
        this.liveThinkingRunId = '';
        for (const item of ChatEvents.mergeHistoryItems(items)) {
          const role = normalizeChatRole(item.role);
          this.appendMessage(
            role,
            item.text || '',
            item.epochMs || item.ts || item.timestamp || Date.now(),
            normalizeChatMedia(item.media || item.attachments || []),
            item.meta || normalizeSenderMeta({}, role, this),
            item.tools || []
          );
        }
      });
    }

    providerHistoryItems(messages, progressMarker = '') {
      const output = [];
      for (const msg of (messages || [])) {
        const role = normalizeChatRole(msg.role);
        const ts = msg.epochMs || msg.ts || msg.timestamp || Date.now();
        if (role === 'assistant') {
          const meta = resolveMessageSender(msg, this);
          const isProgress = progressMarker && msg.ephemeral === progressMarker;
          // Provider history is already in transcript order. Preserve each
          // message boundary and only order blocks inside that message. Some
          // native runtimes reuse one timestamp for an entire turn.
          if (msg.thinking) {
            output.push({
              role: 'assistant',
              text: '',
              thinking: msg.thinking,
              ts,
              meta: { ...meta, thinking: msg.thinking, reasoningTokens: msg.reasoningTokens || 0 }
            });
          }
          if (msg.commentary) {
            output.push({ role: 'assistant', text: msg.commentary, ts, meta });
          }
          normalizeHermesTools(msg.tools || [], !isProgress).forEach((tool) => {
            output.push({ role: 'assistant', text: '', tools: [tool], ts, meta });
          });
          if (msg.text || msg.approval) {
            output.push({
              role: 'assistant',
              text: msg.text || '',
              ts,
              meta: { ...meta, approval: msg.approval || null },
              media: msg.attachments || []
            });
          }
          continue;
        }
        if (msg.text || msg.attachments?.length) {
          output.push({
            role,
            text: msg.text || '',
            ts,
            media: msg.attachments || [],
            meta: resolveMessageSender(msg, this),
            tools: []
          });
        }
      }
      return output;
    }

    openClawHistoryItems(messages) {
      const items = [];
      for (const msg of (messages || [])) {
        const rawRole = msg?.role || msg?.message?.role || '';
        const role = normalizeChatRole(rawRole);
        let text = extractText(msg) || (typeof msg.content === 'string' ? msg.content : '');
        const media = extractMedia(msg, text);
        let tools = extractToolItems(msg);
        if (isToolResultRole(rawRole)) {
          if (!tools.length && text) {
            tools = [{
              id: msg?.toolCallId || msg?.message?.toolCallId || '',
              name: msg?.name || msg?.message?.name || 'tool result',
              status: msg?.error || msg?.message?.error ? 'error' : 'done',
              result: text,
              error: msg?.error || msg?.message?.error || ''
            }];
          }
          text = '';
        }
        if (!text && !media.length && !tools.length) continue;
        items.push({
          role,
          text,
          media,
          tools,
          ts: msg.timestamp || msg.ts || msg.message?.timestamp || null,
          meta: role === 'assistant' ? normalizeSenderMeta({}, 'assistant', this) : resolveMessageSender(msg, this)
        });
      }
      return items;
    }

    async fetchRecoveredActivityItems() {
      if (!this.isVisibleForPolling()) return [];
      try {
        const url = '/api/session-activity?sessionKey=' + encodeURIComponent(this.sessionKey) + '&limit=80';
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = await res.json();
        if (!this.isVisibleForPolling() || !data.ok || !Array.isArray(data.messages)) return [];
        return data.messages.map(msg => {
          if (msg.source === 'codex-commentary' && msg.id) this.seenOpenClawCommentary.add(String(msg.id));
          return {
            id: msg.id || '',
            runId: msg.runId || '',
            source: msg.source || '',
            role: normalizeChatRole(msg.role || 'assistant'),
            text: msg.text || '',
            tools: normalizeHistoricalTools(msg.tools || []),
            ts: msg.epochMs || msg.ts || Date.now(),
            meta: normalizeSenderMeta({}, 'assistant', this),
            media: msg.media || []
          };
        });
      } catch (error) {
        console.warn('[chat] recovered activity load failed:', error);
        return [];
      }
    }

    async syncOpenClawCommentary(runId) {
      if (!runId || !this.isVisibleForPolling() || this.isProviderAgentSelected()) return;
      try {
        const params = new URLSearchParams({
          sessionKey: this.sessionKey,
          runId: String(runId),
          commentaryOnly: '1',
          limit: '80'
        });
        const res = await fetch('/api/session-activity?' + params.toString());
        if (!res.ok) return;
        const data = await res.json();
        if (!data.ok || !Array.isArray(data.messages)) return;
        for (const msg of data.messages) {
          if (msg.source !== 'codex-commentary' || !String(msg.text || '').trim()) continue;
          const expectedRunId = String(runId);
          const messageRunId = String(msg.runId || '');
          const epochMs = ChatEvents.timestampMs(msg.epochMs || msg.ts || '');
          const runStartedAt = ChatEvents.timestampMs(msg.runStartedAt || '');
          const runEndedAt = ChatEvents.timestampMs(msg.runEndedAt || '');
          if (
            !messageRunId || messageRunId !== expectedRunId ||
            !epochMs || !runStartedAt || epochMs < runStartedAt ||
            (runEndedAt && epochMs > runEndedAt)
          ) continue;
          const key = String(msg.id || [messageRunId, epochMs, msg.text].join(':'));
          if (this.seenOpenClawCommentary.has(key)) continue;
          this.seenOpenClawCommentary.add(key);
          this.applyTurnEvent({ kind: 'commentary', runId: messageRunId, text: msg.text, ts: epochMs });
        }
      } catch (error) {
        console.warn('[chat] safe commentary recovery failed:', error);
      }
    }

    queueOpenClawEvent(eventName, payload) {
      this.openClawEventQueue = this.openClawEventQueue
        .catch(() => {})
        .then(async () => {
          const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
          const stream = payload?.stream || data.stream || '';
          const runId = payload?.runId || data.runId || this.currentRunId || '';
          const isToolEvent = eventName === 'agent' && (
            stream === 'tool' ||
            (stream === 'item' && data.kind === 'command') ||
            ['tool_start', 'tool_end', 'tool_result'].includes(payload?.type)
          );
          const isFinalChat = eventName === 'chat' && ['final', 'done'].includes(payload?.state);
          if ((isToolEvent || isFinalChat) && runId) await this.syncOpenClawCommentary(runId);
          if (eventName === 'chat') return this.handleChatEvent(payload);
          if (eventName === 'agent') return this.handleAgentEvent(payload);
          if (eventName === 'session.message') return this.handleSessionMessageEvent(payload);
        });
      return this.openClawEventQueue;
    }

    async loadHistory() {
      try {
        if (this.isLiveModeSessionSelected()) {
          this.startLiveSessionPolling();
          await this.loadLiveModeSessionHistory();
          return;
        }
        if (this.isHermesSelected()) {
          this.startHermesApprovalPolling();
          const res = await fetch('/api/hermes/history?agentId=' + encodeURIComponent(this.getSelectedAgentId() || this.selectedAgentKey));
          const data = await res.json();
          if (data.ok && Array.isArray(data.messages)) {
            this.renderHistoryItems(this.providerHistoryItems(data.messages, 'hermes-progress'));
            this.scrollBottom();
          }
          await this.pollHermesApproval().catch(() => {});
          return;
        }
        if (this.isCodexSelected()) {
          this.startCodexApprovalPolling();
          const res = await fetch('/api/codex/history?agentId=' + encodeURIComponent(this.getSelectedAgentId() || this.selectedAgentKey));
          const data = await res.json();
          if (data.ok && Array.isArray(data.messages)) {
            this.renderHistoryItems(this.providerHistoryItems(data.messages, 'codex-progress'));
            this.scrollBottom();
          }
          return;
        }
        if (this.isGenericProviderSelected()) {
          if (this.supportsProviderApprovals()) this.startCodexApprovalPolling();
          const res = await fetch('/api/providers/history?agentId=' + encodeURIComponent(this.getSelectedAgentId() || this.selectedAgentKey));
          const data = await res.json();
          const msgs = Array.isArray(data.messages) ? data.messages : [];
          this.renderHistoryItems(this.providerHistoryItems(msgs, 'provider-progress'));
          this.scrollBottom();
          return;
        }
        const res = await rpc('chat.history', { sessionKey: this.sessionKey, limit: 500 });
        if (res.ok && res.payload?.messages) {
          const recovered = await this.fetchRecoveredActivityItems();
          this.renderHistoryItems([...this.openClawHistoryItems(res.payload.messages), ...recovered]);
          this.scrollBottom();
        }
      } catch (e) {
        console.warn('Failed to load history:', e);
      }
    }

    async loadLiveModeSessionHistory() {
      const agentId = this.getSelectedAgentId() || parseAgentIdFromSessionKey(this.sessionKey) || this.selectedAgentKey;
      const res = await fetch('/api/chat-sessions/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, sessionId: this.sessionKey, limit: 120 })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || res.statusText);
      const msgs = Array.isArray(data.messages) ? data.messages : [];
      this.replaceHistoryMessages(() => {
        for (const msg of msgs) {
          const tools = normalizeHermesTools(msg.tools || []);
          const meta = msg.role === 'user'
            ? {
                label: msg.from || 'You',
                kind: msg.fromType === 'human' ? 'human' : 'agent',
                source: msg.source || '',
                eventType: msg.eventType || ''
              }
            : {
                label: msg.from || 'Live Agent Mode',
                kind: 'agent',
                thinking: msg.thinking || '',
                reasoningTokens: msg.reasoningTokens || 0,
                approval: msg.approval || null,
                source: msg.source || '',
                eventType: msg.eventType || '',
                modelDecision: msg.modelDecision || null
              };
          if (msg.text || tools.length || msg.thinking || msg.reasoningTokens || msg.approval) {
            this.appendMessage(msg.role || 'assistant', msg.text || '', msg.ts || msg.epochMs || Date.now(), [], meta, tools);
          }
        }
        if (!msgs.length) this.appendSystem('Live Agent Mode has no visible events yet.');
      });
      if (this.liveResponsePendingAt) {
        const receivedReply = msgs.some(msg => {
          if (msg.role !== 'assistant' || msg.eventType !== 'reply') return false;
          const timestamp = Number(msg.epochMs || msg.ts) || Date.parse(msg.ts || msg.at || '') || 0;
          return timestamp >= this.liveResponsePendingAt;
        });
        if (receivedReply) {
          this.liveResponsePendingAt = 0;
        }
      }
      this.scrollBottom();
    }

    async newSession() {
      if (!connected && !this.isProviderAgentSelected()) { this.appendSystem('Not connected'); return; }
      const agentName = this.agentSelect.selectedOptions[0]?.textContent.trim() || 'this agent';
      if (!confirm(`Start a new session for ${agentName}? This clears the conversation history.`)) return;
      try {
        await this.createSessionFromPanel({ skipConfirm: true });
      } catch (e) {
        this.appendSystem('Reset error: ' + e.message);
      }
    }

    // ── Sessions panel (hamburger) ────────────────────────────────────────
    toggleSessionsPanel(force) {
      const next = typeof force === 'boolean' ? force : !this.sessionsPanelOpen;
      this.sessionsPanelOpen = next;
      this.sessionsPanel?.classList.toggle('open', next);
      this.sessionsToggleBtn?.classList.toggle('active', next);
      if (next) {
        this.refreshSessionsList();
        if (!this.sessionsRefreshTimer) {
          this.sessionsRefreshTimer = setInterval(() => {
            if (this.sessionsPanelOpen) this.refreshSessionsList();
          }, 15000);
        }
      } else if (this.sessionsRefreshTimer) {
        clearInterval(this.sessionsRefreshTimer);
        this.sessionsRefreshTimer = null;
      }
    }

    async refreshSessionsList({ showLoading = false } = {}) {
      if (!this.sessionsListEl) return;
      const agentId = this.getSelectedAgentId() || this.selectedAgentKey;
      if (!agentId) return;
      const requestSeq = ++this.sessionsRefreshSeq;
      const requestAgentId = String(agentId);
      if (showLoading) {
        this.currentSessions = [];
        this.sessionsListEl.innerHTML = '';
        const div = document.createElement('div');
        div.className = 'chat-sessions-empty';
        div.textContent = 'Loading sessions...';
        this.sessionsListEl.appendChild(div);
      }
      let data = null;
      try {
        const res = await fetch('/api/chat-sessions?agentId=' + encodeURIComponent(agentId));
        data = await res.json();
      } catch (e) {
        if (requestSeq !== this.sessionsRefreshSeq) return;
        this.sessionsListEl.innerHTML = '<div class="chat-sessions-empty">Sessions unavailable</div>';
        return;
      }
      const currentAgentId = String(this.getSelectedAgentId() || this.selectedAgentKey || '');
      if (requestSeq !== this.sessionsRefreshSeq || requestAgentId !== currentAgentId) return;
      if (!data?.ok || !Array.isArray(data.sessions)) {
        const err = (data && data.error) ? String(data.error) : 'Sessions unavailable';
        this.sessionsListEl.innerHTML = '';
        const div = document.createElement('div');
        div.className = 'chat-sessions-empty';
        div.textContent = err.slice(0, 200);
        this.sessionsListEl.appendChild(div);
        return;
      }
      this.currentSessions = data.sessions;
      this.renderSessionsList(data);
    }

    activeSessionIdForPanel() {
      if (this.getSelectedProviderKind() === 'openclaw' && !this.isProviderAgentSelected()) return this.sessionKey;
      const active = this.currentSessions.find(s => s.active);
      return active ? active.id : '';
    }

    renderSessionsList(data) {
      const listEl = this.sessionsListEl;
      listEl.innerHTML = '';
      if (!this.currentSessions.length) {
        listEl.innerHTML = '<div class="chat-sessions-empty">No sessions yet</div>';
        return;
      }
      const selectedId = this.activeSessionIdForPanel();
      for (const session of this.currentSessions) {
        const item = document.createElement('div');
        item.className = 'chat-session-item';
        if (session.id === selectedId || (session.active && data.providerKind !== 'openclaw')) item.classList.add('selected');
        const title = document.createElement('div');
        title.className = 'cs-title';
        title.textContent = session.title || session.id;
        item.appendChild(title);
        if (session.preview) {
          const preview = document.createElement('div');
          preview.className = 'cs-preview';
          preview.textContent = session.preview;
          item.appendChild(preview);
        }
        const meta = document.createElement('div');
        meta.className = 'cs-meta';
        if (session.liveMode) {
          const live = document.createElement('span');
          live.className = 'cs-live-badge';
          live.textContent = session.active ? 'LIVE' : 'Live Mode';
          meta.appendChild(live);
        }
        if (session.updatedAt) {
          const when = document.createElement('span');
          when.textContent = formatSessionTimestamp(session.updatedAt);
          meta.appendChild(when);
        }
        if (meta.childNodes.length) item.appendChild(meta);
        if (session.deletable) {
          const del = document.createElement('button');
          del.className = 'chat-session-delete';
          del.title = 'Delete session';
          del.textContent = '\u{1F5D1}';
          del.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteSessionFromPanel(session);
          });
          item.appendChild(del);
        }
        item.addEventListener('click', () => this.switchToSession(session));
        listEl.appendChild(item);
      }
    }

    async switchToSession(session) {
      const agentId = this.getSelectedAgentId() || this.selectedAgentKey;
      try {
        if (this.getSelectedProviderKind() === 'openclaw' && !this.isProviderAgentSelected()) {
          // OpenClaw sessions are addressed by key over the gateway directly.
          const nextSessionKey = session.sessionKey || session.id || '';
          const shouldReload = Boolean(session.liveMode) || (nextSessionKey && nextSessionKey !== this.sessionKey);
          if (nextSessionKey) {
            this.sessionKey = nextSessionKey;
            saveChatSelection(this.slotId, { selectedAgentKey: this.selectedAgentKey, sessionKey: this.sessionKey });
          }
          if (shouldReload) {
            this.resetConversation('Switched to session: ' + (session.title || session.sessionKey));
            await this.loadHistory();
            this.fetchSessionInfo();
          }
          this.refreshSessionsList();
          return;
        }
        const res = await fetch('/api/chat-sessions/switch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, sessionId: session.id })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || res.statusText);
        this.resetConversation('Switched to session: ' + (session.title || session.id));
        await this.loadHistory();
        this.refreshSessionsList();
      } catch (e) {
        this.appendSystem('Session switch failed: ' + e.message);
      }
    }

    async createSessionFromPanel({ skipConfirm = false } = {}) {
      const agentId = this.getSelectedAgentId() || this.selectedAgentKey;
      const agentName = this.agentSelect?.selectedOptions?.[0]?.textContent.trim() || agentId;
      if (!skipConfirm && !confirm(`Start a new session for ${agentName}?`)) return;
      try {
        const body = { agentId };
        if (this.getSelectedProviderKind() === 'openclaw' && !this.isProviderAgentSelected()) body.sessionKey = this.sessionKey;
        const res = await fetch('/api/chat-sessions/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || res.statusText);
        this.resetConversation('New session started');
        await this.loadHistory();
        this.fetchSessionInfo();
        this.refreshSessionsList();
      } catch (e) {
        this.appendSystem('New session failed: ' + e.message);
      }
    }

    async deleteSessionFromPanel(session) {
      const agentId = this.getSelectedAgentId() || this.selectedAgentKey;
      if (!confirm(`Delete session "${session.title || session.id}"? This cannot be undone.`)) return;
      try {
        const res = await fetch('/api/chat-sessions/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, sessionId: session.id })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || res.statusText);
        if (session.sessionKey === this.sessionKey || session.active) {
          this.resetConversation('Session deleted');
          await this.loadHistory();
        }
        this.refreshSessionsList();
      } catch (e) {
        this.appendSystem('Delete failed: ' + e.message);
      }
    }

    handleFiles() {
      if (!this.fileInput) return;
      for (const file of this.fileInput.files) {
        const reader = new FileReader();
        reader.addEventListener('load', () => {
          const att = { id: Date.now() + '-' + Math.random().toString(36).slice(2), dataUrl: reader.result, mimeType: file.type || 'application/octet-stream', name: file.name };
          this.pendingAttachments.push(att);
          this.renderAttachmentPreviews();
        });
        reader.readAsDataURL(file);
      }
      this.fileInput.value = '';
    }

    handlePaste(e) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          const reader = new FileReader();
          reader.addEventListener('load', () => {
            const att = { id: Date.now() + '-' + Math.random().toString(36).slice(2), dataUrl: reader.result, mimeType: file.type, name: file.name || 'pasted-image.png' };
            this.pendingAttachments.push(att);
            this.renderAttachmentPreviews();
          });
          reader.readAsDataURL(file);
        }
      }
    }

    renderAttachmentPreviews() {
      this.attachmentsPreview.innerHTML = '';
      for (const att of this.pendingAttachments) {
        const div = document.createElement('div');
        div.className = 'chat-attach-item';
        if (att.mimeType.startsWith('image/')) {
          const img = document.createElement('img');
          img.src = att.dataUrl;
          div.appendChild(img);
        } else {
          const span = document.createElement('div');
          span.className = 'file-name';
          span.textContent = att.name;
          div.appendChild(span);
        }
        const rm = document.createElement('button');
        rm.className = 'chat-attach-remove';
        rm.textContent = '×';
        rm.addEventListener('click', () => {
          this.pendingAttachments = this.pendingAttachments.filter(a => a.id !== att.id);
          this.renderAttachmentPreviews();
        });
        div.appendChild(rm);
        this.attachmentsPreview.appendChild(div);
      }
    }

    async sendMessage() {
      if (!this.isSelectedAgentAvailable()) {
        this.appendSystem('This provider is offline. Saved history remains available, but new messages are disabled.');
        return;
      }
      let text = this.input.value.trim();
      const hasAttachments = this.pendingAttachments.length > 0;
      if ((!text && !hasAttachments) || (!connected && !this.isProviderAgentSelected())) return;

      this.clearRunNotice();
      this.input.value = '';
      this.input.style.setProperty('height', 'auto', 'important');
      this.input.style.overflowY = 'hidden';

      let displayText = text || '';
      const imageDataUrls = this.pendingAttachments.filter(a => a.mimeType.startsWith('image/')).map(a => a.dataUrl);
      const nonImageNames = this.pendingAttachments.filter(a => !a.mimeType.startsWith('image/')).map(a => a.name);
      if (nonImageNames.length) displayText += (displayText ? '\n' : '') + '📎 ' + nonImageNames.join(', ');
      this.appendMessage('user', displayText, Date.now(), imageDataUrls, { label: 'You', kind: 'human' });
      this.scrollBottom();

      let attachments;
      let providerAttachments = [];
      if (hasAttachments) {
        const UPLOAD_URL = window.location.origin + '/upload';
        const imageAtts = [];
        const docPaths = [];

        for (const a of this.pendingAttachments) {
          if (a.mimeType.startsWith('image/')) {
            const url = await compressImage(a.dataUrl);
            const parsed = parseDataUrl(url);
            if (parsed) imageAtts.push({ type: 'image', mimeType: parsed.mimeType, content: parsed.content });
            try {
              const b64raw = a.dataUrl.split(',')[1];
              const resp = await fetch(UPLOAD_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: a.name, content: b64raw })
              });
              if (resp.ok) {
                const result = await resp.json();
                docPaths.push(result.path);
              }
            } catch (_) {}
          } else if (a.mimeType.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|flac|webm|opus|aac)$/i.test(a.name)) {
            this.appendSystem('🎤 Transcribing ' + a.name + '...');
            try {
              const b64 = a.dataUrl.split(',')[1];
              const audioBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
              const resp = await fetch('/transcribe', {
                method: 'POST', headers: { 'Content-Type': a.mimeType || 'audio/webm' }, body: audioBytes
              });
              const data = await resp.json();
              if (data.text && data.text.trim()) {
                text = text ? text + '\n[Audio transcription: ' + data.text.trim() + ']' : '[Audio transcription: ' + data.text.trim() + ']';
                this.appendSystem('✅ Transcription complete');
              } else if (data.error) {
                this.appendSystem('❌ Transcription error: ' + data.error);
              } else {
                this.appendSystem('⚠️ No speech detected in audio');
              }
            } catch (e) {
              this.appendSystem('❌ Transcription failed: ' + e.message);
            }
          } else {
            try {
              const b64 = a.dataUrl.split(',')[1];
              const resp = await fetch(UPLOAD_URL, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: a.name, content: b64 })
              });
              if (resp.ok) {
                const result = await resp.json();
                docPaths.push(result.path);
              } else {
                this.appendSystem('Upload failed for ' + a.name + ': ' + resp.statusText);
              }
            } catch (e) {
              this.appendSystem('Upload failed for ' + a.name + ': ' + e.message);
            }
          }
        }

        if (docPaths.length) {
          const pathNote = docPaths.map(p => '(attached file: ' + p + ')').join('\n');
          text = text ? text + '\n' + pathNote : pathNote;
        }
        providerAttachments = docPaths.map(path => ({ path }));
        attachments = imageAtts.length ? imageAtts : undefined;
      }

      this.pendingAttachments = [];
      this.renderAttachmentPreviews();

      const params = { sessionKey: this.sessionKey, message: text || '(attached files)', idempotencyKey: `vw-${Date.now()}-${Math.random().toString(36).slice(2)}` };
      if (attachments?.length) params.attachments = attachments;

      if (this.isLiveModeSessionSelected()) {
        const agentId = this.getSelectedAgentId() || this.selectedAgentKey;
        try {
          const response = await fetch('/api/agent-live-sessions/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId,
              sessionId: this.sessionKey,
              message: text || '(attached files)'
            })
          });
          const data = await response.json();
          if (!response.ok || data.ok === false) throw new Error(data?.error?.message || data.error || response.statusText);
          if (data.pending) this.liveResponsePendingAt = Date.now() - 1000;
          await this.loadLiveModeSessionHistory();
          this.scrollBottom();
        } catch (error) {
          this.showRunNotice('Response not completed', error.message);
        }
        return;
      }

      // User attention outranks Live autonomy. Keep the lease through the
      // provider run, then shorten it to a conversational grace period so the
      // Resident does not immediately walk away after replying.
      const liveAttentionAgentId = this.noteLiveAgentUserAttention(text || '');
      this.pendingLiveAttentionAgentId = liveAttentionAgentId;

      if (this.isHermesSelected()) {
        const hermesLabel = this.agentSelect.selectedOptions[0]?.textContent.trim() || 'Hermes';
        const hermesProgress = this.startHermesProgress(hermesLabel);
        const hermesSendStartedAt = Date.now();
        const hermesBody = {
          agentId: this.getSelectedAgentId() || this.selectedAgentKey,
          message: text || '(attached files)',
          sessionId: String(this.sessionKey || '').split(':').slice(2).join(':'),
          timeoutSec: 180,
          fromType: 'human',
          fromDisplayName: 'User',
          sourceApp: 'virtual-world',
          sourceSurface: 'chat-window',
          sourceLabel: 'Virtual World Chat'
        };
        try {
          const resp = await fetch('/api/hermes/runs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(hermesBody)
          });
          const data = await resp.json();
          if (!resp.ok || data.ok === false) {
            if (data.fallback) {
              await this.sendHermesBlockingMessage({ ...hermesBody, liveRunId: hermesProgress?.runId || '', forceCliFallback: true }, hermesProgress);
              this.settleLiveAgentUserAttention(liveAttentionAgentId);
              return;
            }
            throw new Error(data.error || data.reply || resp.statusText);
          }
          this.currentRunId = data.runId || null;
          this.rememberLiveAttentionForRun(data.runId, liveAttentionAgentId);
          await this.streamHermesRunEvents(data.runId, hermesProgress);
          this.removeTypingIndicator();
          this.finishHermesProgress(hermesProgress, true);
          await this.loadHistory({ recoverFinal: true, startedAt: hermesSendStartedAt });
          await this.pollHermesApproval().catch(() => {});
          this.scrollBottom();
        } catch (e) {
          this.closeHermesEventSource();
          this.finishHermesProgress(hermesProgress, false, e.message);
          this.removeTypingIndicator();
          const recovered = await this.recoverHermesFinalFromHistory(hermesSendStartedAt).catch(() => false);
          if (recovered) {
            await this.pollHermesApproval().catch(() => {});
            this.settleLiveAgentUserAttention(liveAttentionAgentId);
            return;
          }
          if (!e.turnReducerHandled) {
            this.applyTurnEvent({ kind: 'run.failed', runId: this.currentRunId || hermesProgress?.runId || '', error: e.message });
          }
        } finally {
          this.clearLiveAttentionForRun(this.currentRunId);
          this.settleLiveAgentUserAttention(liveAttentionAgentId);
        }
        return;
      }

      if (this.isCodexSelected()) {
        const codexLabel = this.agentSelect.selectedOptions[0]?.textContent.trim() || 'Codex';
        const codexSendStartedAt = Date.now();
        const codexBody = {
          agentId: this.getSelectedAgentId() || this.selectedAgentKey,
          message: text || '(attached files)',
          timeoutSec: 180,
          fromType: 'human',
          fromDisplayName: 'User',
          sourceApp: 'virtual-world',
          sourceSurface: 'chat-window',
          sourceLabel: 'Virtual World Chat'
        };
        try {
          const resp = await fetch('/api/codex/runs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(codexBody)
          });
          const data = await resp.json();
          if (!resp.ok || data.ok === false) {
            if (data.fallback) {
              await this.sendCodexBlockingMessage(codexBody, codexLabel);
              this.settleLiveAgentUserAttention(liveAttentionAgentId);
              return;
            }
            throw new Error(data.error || data.reply || resp.statusText);
          }
          this.currentRunId = data.runId || null;
          this.rememberLiveAttentionForRun(data.runId, liveAttentionAgentId);
          await this.streamCodexRunEvents(data.runId);
          this.removeTypingIndicator();
          await this.loadHistory({ recoverFinal: true, startedAt: codexSendStartedAt });
          await this.fetchSessionInfo();
          this.scrollBottom();
        } catch (e) {
          this.closeCodexEventSource();
          if (!e.turnReducerHandled) {
            this.applyTurnEvent({ kind: 'run.failed', runId: this.currentRunId || `codex-failed-${codexSendStartedAt}`, error: e.message });
          }
        } finally {
          this.clearLiveAttentionForRun(this.currentRunId);
          this.settleLiveAgentUserAttention(liveAttentionAgentId);
        }
        return;
      }

      if (this.isGenericProviderSelected()) {
        const providerLabel = this.agentSelect.selectedOptions[0]?.textContent.trim() || 'Agent';
        this.updateTypingIndicator(`${providerLabel} is running…`);
        try {
          const resp = await fetch('/api/providers/runs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId: this.getSelectedAgentId() || this.selectedAgentKey,
              message: text || '(attached files)',
              sessionId: String(this.sessionKey || '').split(':').slice(2).join(':'),
              timeoutSec: 900,
              attachments: providerAttachments,
            })
          });
          const data = await resp.json();
          if (!resp.ok || data.ok === false) throw new Error(data.error || data.reply || resp.statusText);
          this.currentRunId = data.runId || null;
          await this.streamProviderSdkRun(data.runId, providerLabel);
          await this.loadHistory();
          await this.fetchSessionInfo();
          this.scrollBottom();
        } catch (e) {
          this.closeProviderEventSource();
          if (!e.turnReducerHandled) {
            this.applyTurnEvent({ kind: 'run.failed', runId: this.currentRunId || `provider-failed-${Date.now()}`, error: e.message });
          }
        } finally {
          this.settleLiveAgentUserAttention(liveAttentionAgentId);
        }
        return;
      }

      const sendSessionKey = this.sessionKey;
      rpc('chat.send', params).then(res => {
        if (!res?.ok) throw new Error(extractRunError(res));
        if (res.payload?.runId) {
          this.currentRunId = res.payload.runId;
          runOwners.set(res.payload.runId, { slotId: this.slotId, sessionKey: sendSessionKey });
          this.rememberLiveAttentionForRun(res.payload.runId, liveAttentionAgentId);
        } else {
          this.removeTypingIndicator();
          this.showRunNotice('Response not started', 'The agent framework accepted the request but did not return a run id.');
          this.settleLiveAgentUserAttention(liveAttentionAgentId);
        }
      }).catch(e => {
        this.removeTypingIndicator();
        this.showRunNotice('Response not started', e?.message || String(e));
        this.settleLiveAgentUserAttention(liveAttentionAgentId);
      });
    }

    async sendStop() {
      try {
        if (this.isLiveModeSessionSelected()) {
          const resp = await fetch('/api/agent-live-sessions/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId: this.getSelectedAgentId() || this.selectedAgentKey,
              sessionId: this.sessionKey,
              message: 'Stop and wait for me.'
            })
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || data.ok === false) throw new Error(data?.error?.message || data.error || resp.statusText);
          await this.loadLiveModeSessionHistory();
          return;
        }
        if (this.isHermesSelected()) {
          const resp = await fetch('/api/hermes/interrupt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId: this.getSelectedAgentId() || this.selectedAgentKey, runId: this.currentRunId || '' })
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || data.ok === false) throw new Error(data.error || resp.statusText);
          this.applyTurnEvent({ kind: 'run.cancelled', runId: this.currentRunId || '' });
          this.appendSystem('Stop sent');
          return;
        }
        if (this.isGenericProviderSelected()) {
          const resp = await fetch('/api/providers/interrupt', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ agentId:this.getSelectedAgentId() || this.selectedAgentKey, runId:this.currentRunId || '' }),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || data.ok === false) throw new Error(data.error || resp.statusText);
          this.closeProviderEventSource();
          this.applyTurnEvent({ kind: 'run.cancelled', runId: this.currentRunId || '' });
          this.appendSystem('🛑 Stop sent');
          return;
        }
        if (this.isCodexSelected()) {
          const resp = await fetch('/api/codex/interrupt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId: this.getSelectedAgentId() || this.selectedAgentKey, runId: this.currentRunId || '' })
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || data.ok === false) throw new Error(data.error || resp.statusText);
          this.applyTurnEvent({ kind: 'run.cancelled', runId: this.currentRunId || '' });
          this.appendSystem('Stop sent');
          return;
        }
        const params = { sessionKey: this.sessionKey };
        if (this.currentRunId) params.runId = this.currentRunId;
        const res = await rpc('chat.abort', params);
        if (res?.ok === false) throw new Error(res.error?.message || 'abort failed');
        this.applyTurnEvent({ kind: 'run.cancelled', runId: this.currentRunId || '' });
        this.appendSystem('🛑 Stop sent');
      } catch (e) {
        this.appendSystem('Failed to stop: ' + e.message);
      }
    }

    async toggleRecording() {
      if (this.isRecording) return this.stopRecording();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        this.audioChunks = [];
        this.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) this.audioChunks.push(e.data); };
        this.mediaRecorder.onstop = async () => {
          stream.getTracks().forEach(t => t.stop());
          const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
          await this.transcribeAudio(blob);
        };
        this.mediaRecorder.start();
        this.isRecording = true;
        this.micBtn.classList.add('recording');
        this.micBtn.innerHTML = '■';
      } catch (e) {
        this.appendSystem('Microphone access denied');
      }
    }

    stopRecording() {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop();
      this.isRecording = false;
      this.micBtn.classList.remove('recording');
      this.micBtn.innerHTML = '🎙️';
    }

    async transcribeAudio(blob) {
      this.micBtn.innerHTML = '···';
      this.micBtn.disabled = true;
      try {
        const resp = await fetch('/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: blob });
        const data = await resp.json();
        if (data.text) {
          this.input.value = (this.input.value ? this.input.value + ' ' : '') + data.text;
          this.scheduleAutoResizeInput();
          this.input.focus();
        } else if (data.error) {
          this.appendSystem('Transcription error: ' + data.error);
        }
      } catch (e) {
        this.appendSystem('Transcription failed: ' + e.message);
      }
      this.micBtn.innerHTML = '🎙️';
      this.micBtn.disabled = false;
    }

    ownsPayload(payload) {
      if (!payload) return false;
      if (payload.sessionKey) return payload.sessionKey === this.sessionKey;
      if (payload.runId && this.currentRunId && payload.runId === this.currentRunId) return true;
      const owner = payload.runId ? runOwners.get(payload.runId) : null;
      if (owner) return owner.slotId === this.slotId && owner.sessionKey === this.sessionKey;
      return false;
    }

    applyTurnEvent(event) {
      const actions = this.turnEvents.ingest(event);
      actions.forEach(action => this.applyTurnAction(action));
      return actions;
    }

    applyDistinctThinking(runId, value) {
      const thinking = String(value || '').trim();
      const visibleText = this.turnEvents.get(runId)?.fullText?.trim() || '';
      // Native runtimes sometimes repeat the already visible final answer in
      // a reasoning field. It is not a second Thinking item.
      if (!thinking || thinking === visibleText) return false;
      this.applyTurnEvent({ kind: 'thinking', runId, text: thinking });
      return true;
    }

    applyTurnAction(action) {
      if (!action) return;
      const runId = action.runId || this.currentRunId || '';
      if (runId) this.currentRunId = runId;

      if (action.kind === 'run.start') {
        if (action.label) this.updateTypingIndicator(action.label);
        return;
      }

      if (action.kind === 'text.open' || action.kind === 'text.update') {
        if (!this.streamingMsg || this.streamingMsg.id !== runId || !this.messages.querySelector('.streaming-msg')) {
          this.streamingMsg = { id: runId, role: 'assistant', content: '' };
          this.appendStreamingMessage(runId);
        }
        this.streamingMsg.content = action.text || '';
        this.updateStreamingMessage(this.streamingMsg.content);
        return;
      }

      if (action.kind === 'text.finalize') {
        const text = action.text || this.streamingMsg?.content || '';
        this.renderStreamingMessageText(text);
        if (this.streamingMsg) this.finalizeStreamingMessage(text, undefined, runId, action.ts || Date.now());
        this.streamingMsg = null;
        return;
      }

      if (action.kind === 'text.amend') {
        this.amendFinalizedMessage(runId, action.text || '');
        return;
      }

      if (action.kind === 'text.discard') {
        this.discardStreamingMessage();
        this.streamingMsg = null;
        return;
      }

      if (action.kind === 'thinking') {
        this.updateLiveThinking(runId, action.text || '');
        return;
      }

      if (action.kind === 'tool.start' || action.kind === 'tool.update' || action.kind === 'tool.result') {
        const tool = action.tool || {};
        const payload = {
          runId,
          data: {
            toolCallId: tool.id || tool.key || '',
            phase: action.kind === 'tool.start' ? 'start' : (action.kind === 'tool.update' ? 'update' : 'result'),
            name: tool.name || 'tool',
            args: tool.arguments || {},
            result: tool.result || '',
            isError: tool.status === 'error' || !!tool.error,
            error: tool.error || ''
          }
        };
        if (action.kind === 'tool.start') this.appendToolCall(payload);
        else if (action.kind === 'tool.update') this.updateToolCall(payload);
        else this.finishToolCall(payload);
        return;
      }

      if (action.kind === 'approval') {
        if (action.provider === 'codex') this.appendCodexPendingApproval(action.approval, action.approval?.pending_count || 1);
        else if (action.provider === 'hermes') this.appendHermesPendingApproval(action.approval, action.approval?.pending_count || 1);
        else {
          const approvalId = action.approval?.id || action.approval?.approval_id || '';
          const selector = approvalId ? `[data-approval-id="${CSS.escape(approvalId)}"]` : '';
          if (!selector || !this.messages.querySelector(selector)) {
            this.appendMessage('assistant', '', Date.now(), [], {
              label: this.agentSelect?.selectedOptions?.[0]?.textContent.trim() || action.provider || 'Provider',
              kind: 'agent',
              approval: action.approval
            }, []);
          }
        }
        return;
      }

      if (action.kind === 'run.terminal') this.finishRunUi(runId, action.status, action.error || '');
    }

    finishRunUi(runId, status = 'completed', errorText = '') {
      if (this.streamingMsg) {
        const text = this.streamingMsg.content || '';
        if (text.trim()) this.finalizeStreamingMessage(text, undefined, runId);
        else this.discardStreamingMessage();
      }
      this.streamingMsg = null;
      this.cancelStreamingRender();
      this.clearActivityFeed();
      this.removeTypingIndicator();
      this.settleLiveThinking(runId);
      this.finalizeRunToolCards(runId, status, errorText);
      if (status === 'failed') {
        this.showRunNotice(classifyFailureStatus(errorText), errorText || 'The run failed before returning a reply.', runId);
      }
      if (runId) runOwners.delete(runId);
      this.clearLiveAttentionForRun(runId);
      if (!runId || this.currentRunId === runId) this.currentRunId = null;
      this.scrollBottom();
    }

    settleLiveThinking(runId) {
      if (!this.liveThinkingEl) return;
      if (runId && this.liveThinkingEl.dataset.runId && this.liveThinkingEl.dataset.runId !== runId) return;
      this.liveThinkingEl.classList.remove('chat-thinking-live');
      this.liveThinkingEl.classList.add('chat-thinking-settled');
      const card = this.liveThinkingEl.querySelector('.chat-thinking-card');
      if (card) card.open = false;
      this.liveThinkingEl = null;
      this.liveThinkingPre = null;
      this.liveThinkingRunId = '';
    }

    handleChatEvent(payload) {
      if (!this.ownsPayload(payload)) return;
      this.markLiveEvent();
      const disposition = classifyChatEvent(payload);
      const runId = getOpenClawRunId(payload, this.currentRunId) || 'openclaw-run';
      if (disposition === 'terminal-error') {
        if (!getOpenClawRunId(payload, this.currentRunId)) return;
        const pending = this.openClawRunTracker.consumePending(runId);
        const message = extractRunError(payload, '') || extractRunError(pending, '') || 'The run failed before returning a reply.';
        if (this.openClawRunTracker.markFailed(runId)) this.applyTurnEvent({ kind: 'run.failed', runId, error: message });
        return;
      }
      const text = extractText(payload);
      if (disposition === 'streaming') {
        if (text) this.applyTurnEvent({ kind: 'text.replace', runId, text });
      } else if (disposition === 'success') {
        const finalText = text || this.streamingMsg?.content || '';
        this.openClawRunTracker.markSucceeded(runId);
        this.clearRunNotice(runId);
        if (finalText) this.applyTurnEvent({ kind: 'text.replace', runId, text: finalText });
        this.applyTurnEvent({ kind: 'run.complete', runId });
        this.fetchContextUsage();
      }
    }

    handleAgentEvent(payload) {
      if (!this.ownsPayload(payload)) return;
      const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
      const phase = data.phase || payload?.phase || '';
      const disposition = classifyAgentEvent(payload);
      const runId = getOpenClawRunId(payload, this.currentRunId) || 'openclaw-run';

      if (disposition === 'tool') {
        this.markLiveEvent();
        const tool = normalizeToolEvent(payload, phase === 'result' ? 'done' : 'running');
        const label = formatToolLabel(tool.name, coerceToolArgs(tool.arguments));
        this.updateTypingIndicator((phase === 'result' || phase === 'end' || payload?.type === 'tool_end' || payload?.type === 'tool_result') ? 'Processing...' : label);
        const isTerminal = phase === 'result' || phase === 'end' || payload?.type === 'tool_end' || payload?.type === 'tool_result';
        const isUpdate = phase === 'update';
        this.applyTurnEvent({ kind: isTerminal ? 'tool.result' : (isUpdate ? 'tool.update' : 'tool.start'), runId, tool });
        return;
      }

      if (disposition === 'pending-error') {
        this.openClawRunTracker.notePending(payload, this.currentRunId);
        return;
      }

      if (disposition === 'thinking') {
        const thinking = data.thinking || data.text || payload?.thinking || payload?.text || '';
        if (thinking) this.applyDistinctThinking(runId, thinking);
        else this.applyTurnEvent({ kind: 'run.start', runId, label: 'Thinking...' });
        this.updateTypingIndicator('Thinking...');
      }
    }

    handleSessionMessageEvent(payload) {
      if (!this.ownsPayload(payload)) return;
      const msg = payload?.message && typeof payload.message === 'object' ? payload.message : payload;
      const role = msg?.role || payload?.role || '';
      if (role === 'assistant') {
        this.markLiveEvent();
        return this.loadHistory();
      }
      if (role === 'user') this.markLiveEvent();
    }

    finishOpenClawRunError(payload) {
      const runId = getOpenClawRunId(payload, this.currentRunId);
      const streamingText = this.streamingMsg?.content || '';
      const pendingPayload = this.openClawRunTracker.consumePending(runId);
      if (!this.openClawRunTracker.markFailed(runId)) return;
      const message = extractRunError(payload, '') || extractRunError(pendingPayload, '') || 'The run failed before returning a reply.';
      const failureStatus = classifyFailureStatus(message, payload);
      this.cancelStreamingRender();
      this.flushToolEvents(true);
      this.clearActivityFeed();
      this.removeTypingIndicator();
      if (this.streamingMsg) {
        if (streamingText.trim()) this.finalizeStreamingMessage(streamingText);
        else this.discardStreamingMessage();
        this.streamingMsg = null;
      } else {
        this.discardStreamingMessage();
      }
      this.showRunNotice(failureStatus, message, runId);
      if (runId) {
        this.finalizeRunToolCards(runId);
        runOwners.delete(runId);
      }
      this.clearLiveAttentionForRun(runId);
      this.currentRunId = null;
      this.fetchSessionInfo();
      this.scrollBottom();
    }

    markLiveEvent() {
      this.lastLiveEventAt = Date.now();
    }

    queueToolEvent(payload) {
      const key = this.toolKey(payload);
      const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
      const phase = data.phase || payload?.phase || '';
      const isTerminal = phase === 'result' || phase === 'end' || payload?.type === 'tool_end' || payload?.type === 'tool_result';

      // Fast tools can emit start + result inside the render debounce window.
      // Preserve the unrendered start so the result has a visible card to finish.
      if (isTerminal && this.pendingToolEvents.has(key) && !this.liveToolCards.has(key)) {
        const startPayload = this.pendingToolEvents.get(key);
        this.pendingToolEvents.delete(key);
        this.appendToolCall(startPayload);
        this.finishToolCall(payload);
        if (!this.toolFlushTimer && this.pendingToolEvents.size) this.toolFlushTimer = setTimeout(() => this.flushToolEvents(), TOOL_RENDER_INTERVAL_MS);
        return;
      }

      this.pendingToolEvents.set(key, payload);
      if (!this.toolFlushTimer) this.toolFlushTimer = setTimeout(() => this.flushToolEvents(), TOOL_RENDER_INTERVAL_MS);
    }

    flushToolEvents() {
      if (this.toolFlushTimer) { clearTimeout(this.toolFlushTimer); this.toolFlushTimer = null; }
      if (!this.pendingToolEvents.size) return;
      const events = [...this.pendingToolEvents.values()];
      this.pendingToolEvents.clear();
      for (const payload of events) {
        const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
        const phase = data.phase || payload?.phase || '';
        if (phase === 'result' || phase === 'end' || payload?.type === 'tool_end' || payload?.type === 'tool_result') this.finishToolCall(payload);
        else if (phase === 'update') this.updateToolCall(payload);
        else this.appendToolCall(payload);
      }
      this.pruneToolCards();
      this.scrollBottom();
    }

    appendMessage(role, content, ts, mediaItems, meta = {}, toolItems = []) {
      const div = document.createElement('div');
      div.className = `chat-msg ${role}`;
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      let displayContent = content || '';
      const envelope = parseA2AEnvelope(displayContent);
      if (envelope) {
        displayContent = envelope.text;
        meta = { ...meta, label: envelope.label, toLabel: envelope.toLabel || meta.toLabel, kind: 'agent' };
      }
      if (role === 'assistant' && meta.thinking && String(meta.thinking).trim() === String(displayContent || '').trim()) {
        meta = { ...meta, thinking: '', reasoningTokens: 0 };
      }
      meta = normalizeSenderMeta(meta, role, this);
      if (meta.kind) div.dataset.senderKind = meta.kind;
      if (role === 'tool' && displayContent.length > 3000) {
        displayContent = displayContent.substring(0, 2000) + '\n\n... [truncated - ' + displayContent.length + ' chars total] ...';
      }
      const extractedMedia = extractMedia({ content: displayContent }, displayContent);
      const media = normalizeChatMedia([...(mediaItems || []), ...extractedMedia]);
      displayContent = displayContent.split(/\r?\n/).filter(line => {
        const t = line.trim();
        return !(t.match(/^\(attached file:\s*(.+?)\)$/i) || t.match(/^attached file:\s*(.+)$/i) || t.match(/^MEDIA:/i));
      }).join('\n').trim();
      if (media.length) {
        bubble.appendChild(renderChatMedia(media));
      }
      const senderHeader = renderSenderHeader(meta, role);
      if (senderHeader) bubble.appendChild(senderHeader);
      if (role === 'assistant' && (meta.thinking || meta.reasoningTokens)) {
        bubble.appendChild(renderThinkingCard(meta.thinking || `Reasoning trace stored by Hermes provider. Reasoning tokens: ${meta.reasoningTokens}`));
      }
      if (role === 'assistant' && meta.approval) {
        bubble.appendChild(renderHermesApprovalCard(meta.approval, this));
      }
      if (displayContent.trim()) {
        const plannerTurn = role === 'assistant' && this.isLiveModeSessionSelected() && meta.eventType === 'planner-reply'
          ? renderLivePlannerTurn(displayContent)
          : null;
        if (plannerTurn) {
          bubble.classList.add('chat-live-planner-bubble');
          bubble.appendChild(plannerTurn);
        } else {
          const textDiv = document.createElement('div');
          textDiv.className = 'chat-markdown';
          textDiv.innerHTML = formatContent(displayContent);
          bubble.appendChild(textDiv);
        }
      }
      for (const tool of toolItems) bubble.appendChild(renderToolCallCard(tool, { historical: true }));
      if (ts) {
        const time = document.createElement('span');
        time.className = 'chat-time';
        time.textContent = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        bubble.appendChild(time);
      }
      div.appendChild(bubble);
      this.removeTypingIndicator();
      this.messages.appendChild(div);
    }

    appendStreamingMessage(runId = '') {
      this.removeTypingIndicator();
      const existing = this.messages.querySelector('.streaming-msg');
      if (existing) existing.classList.remove('streaming-msg');
      const div = document.createElement('div');
      div.className = 'chat-msg assistant streaming-msg';
      div.dataset.runId = runId || this.currentRunId || '';
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble streaming';
      const text = document.createElement('div');
      text.className = 'chat-markdown streaming-text';
      const cursor = document.createElement('span');
      cursor.className = 'cursor';
      cursor.textContent = '▊';
      bubble.appendChild(text);
      bubble.appendChild(cursor);
      div.appendChild(bubble);
      this.messages.appendChild(div);
      this.streamingRenderedContent = '';
    }

    cancelStreamingRender() {
      if (this.streamingRenderTimer) clearTimeout(this.streamingRenderTimer);
      this.streamingRenderTimer = null;
      this.streamingPendingContent = '';
    }

    discardStreamingMessage() {
      this.cancelStreamingRender();
      const div = this.messages.querySelector('.streaming-msg');
      if (div) div.remove();
    }

    updateStreamingMessage(content) {
      this.streamingPendingContent = content || '';
      if (this.streamingRenderTimer) return;
      this.streamingRenderTimer = setTimeout(() => {
        this.streamingRenderTimer = null;
        this.renderStreamingMessageText(this.streamingPendingContent);
      }, STREAMING_TEXT_RENDER_INTERVAL_MS);
    }

    renderStreamingMessageText(content) {
      const div = this.messages.querySelector('.streaming-msg');
      if (!div) return;
      const bubble = div.querySelector('.chat-bubble');
      let text = bubble.querySelector('.streaming-text');
      if (!text) {
        text = document.createElement('div');
        text.className = 'chat-markdown streaming-text';
        const cursor = document.createElement('span');
        cursor.className = 'cursor';
        cursor.textContent = '▊';
        bubble.appendChild(text);
        bubble.appendChild(cursor);
      }
      const nextContent = content || '';
      if (nextContent === this.streamingRenderedContent) return;
      text.innerHTML = formatContent(nextContent);
      this.streamingRenderedContent = nextContent;
      this.scrollBottom();
    }

    finalizeStreamingMessage(content, mediaItems, runId = '', ts = Date.now()) {
      this.cancelStreamingRender();
      const div = this.messages.querySelector('.streaming-msg');
      if (!div) return this.appendMessage('assistant', content, ts || Date.now(), mediaItems);
      const bubble = div.querySelector('.chat-bubble');
      bubble.classList.remove('streaming');
      const textDiv = bubble.querySelector('.streaming-text');
      const cursor = bubble.querySelector('.cursor');
      const finalContent = content || '';
      if (textDiv && finalContent !== this.streamingRenderedContent) {
        textDiv.innerHTML = formatContent(finalContent);
      }
      this.streamingRenderedContent = finalContent;
      cursor?.remove();
      textDiv?.classList.remove('streaming-text');
      const senderHeader = renderSenderHeader(normalizeSenderMeta({}, 'assistant', this), 'assistant');
      if (senderHeader) bubble.insertBefore(senderHeader, textDiv || bubble.firstChild);
      const media = normalizeChatMedia(mediaItems || extractMedia({ content }, content));
      if (media.length) {
        const renderedMedia = renderChatMedia(media);
        bubble.insertBefore(renderedMedia, textDiv || bubble.querySelector('.chat-time'));
      }
      if (!finalContent.trim()) {
        textDiv?.remove();
      } else if (!textDiv) {
        const finalText = document.createElement('div');
        finalText.className = 'chat-markdown';
        finalText.innerHTML = formatContent(finalContent);
        bubble.appendChild(finalText);
      }
      const time = document.createElement('span');
      time.className = 'chat-time';
      time.textContent = new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      bubble.appendChild(time);
      div.classList.remove('streaming-msg');
      div.classList.add('chat-stream-segment');
      div.dataset.runId = runId || div.dataset.runId || this.currentRunId || '';
      return div;
    }

    amendFinalizedMessage(runId, content) {
      const segments = [...this.messages.querySelectorAll('.chat-stream-segment')];
      const div = segments.reverse().find(item => !runId || item.dataset.runId === String(runId));
      if (!div) return this.finalizeStreamingMessage(content, undefined, runId);
      const bubble = div.querySelector('.chat-bubble');
      if (!bubble) return;
      let textDiv = bubble.querySelector('.chat-markdown');
      if (!textDiv) {
        textDiv = document.createElement('div');
        textDiv.className = 'chat-markdown';
        const time = bubble.querySelector('.chat-time');
        bubble.insertBefore(textDiv, time || null);
      }
      textDiv.innerHTML = formatContent(content || '');
      div.classList.remove('chat-stream-segment-settling');
      void div.offsetWidth;
      div.classList.add('chat-stream-segment-settling');
      this.scrollBottom();
    }

    appendSystem(text) {
      const div = document.createElement('div');
      div.className = 'chat-msg system';
      div.innerHTML = `<div class="chat-bubble system-bubble">${escHtml(text)}</div>`;
      this.messages.appendChild(div);
      this.scrollBottom();
    }

    updateTypingIndicator(text) {
      let ind = this.messages.querySelector('.typing-indicator');
      if (!ind) {
        ind = document.createElement('div');
        ind.className = 'chat-msg assistant typing-indicator';
        ind.innerHTML = `<div class="chat-bubble typing"><span class="typing-text">${escHtml(text)}</span><span class="typing-dots"><span>.</span><span>.</span><span>.</span></span></div>`;
        this.messages.appendChild(ind);
      } else {
        ind.querySelector('.typing-text').textContent = text;
      }
      this.scrollBottom();
    }

    removeTypingIndicator() {
      const ind = this.messages.querySelector('.typing-indicator');
      if (ind) ind.remove();
    }

    clearActivityFeed() { this.messages.querySelectorAll('.chat-activity').forEach(el => el.remove()); }

    closeNativeEventSource(provider) {
      const cfg = NATIVE_PROVIDER_UI[provider];
      if (!cfg) return;
      const source = this[cfg.sourceProperty];
      if (source) {
        try { source.close(); } catch (_) {}
        this[cfg.sourceProperty] = null;
      }
    }

    closeHermesEventSource() { this.closeNativeEventSource('hermes'); }

    closeCodexEventSource() { this.closeNativeEventSource('codex'); }

    closeProviderEventSource() {
      if (this.providerEventSource) {
        try { this.providerEventSource.close(); } catch (_) {}
        this.providerEventSource = null;
      }
    }

    isNearMessagesBottom() {
      const remaining = this.messages.scrollHeight - this.messages.clientHeight - this.messages.scrollTop;
      return remaining <= CHAT_BOTTOM_FOLLOW_THRESHOLD;
    }

    noteManualScrollIntent(direction = 0) {
      this.manualScrollIntentUntil = performance.now() + CHAT_MANUAL_SCROLL_INTENT_MS;
      this.manualScrollBottomTarget = Math.max(0, this.messages.scrollHeight - this.messages.clientHeight);
      this.manualScrollDirection = Number(direction) || 0;
      if (this.manualScrollDirection < 0) {
        this.followLatest = false;
        this.cancelPendingScrollBottom();
        this.updateScrollLatestButton();
      }
    }

    clearManualScrollIntent() {
      this.manualScrollIntentUntil = 0;
      this.manualScrollBottomTarget = 0;
      this.manualScrollDirection = 0;
    }

    hasManualScrollIntent() {
      return performance.now() <= this.manualScrollIntentUntil;
    }

    handleMessagesScroll() {
      if (this.scrollTrackingSuspended) return;
      const nearBottom = this.isNearMessagesBottom();
      const manualScrollIntent = this.hasManualScrollIntent();
      const currentScrollTop = this.messages.scrollTop;
      const movedUp = currentScrollTop < this.lastMessagesScrollTop - 0.5;
      this.lastMessagesScrollTop = currentScrollTop;
      const reachedManualBottom = manualScrollIntent && (
        this.messages.scrollTop >= this.manualScrollBottomTarget - CHAT_BOTTOM_REATTACH_THRESHOLD
      );
      if (manualScrollIntent && (this.manualScrollDirection < 0 || movedUp)) {
        this.followLatest = false;
        this.cancelPendingScrollBottom();
      } else if (reachedManualBottom || (!manualScrollIntent && nearBottom)) {
        this.followLatest = true;
        this.clearManualScrollIntent();
      }
      this.updateScrollLatestButton();
      if (this.followLatest && !nearBottom) this.scrollBottom();
    }

    replaceHistoryMessages(renderMessages) {
      const scrollState = {
        followLatest: this.followLatest,
        scrollTop: this.messages.scrollTop
      };
      this.scrollTrackingSuspended = true;
      this.messages.innerHTML = '';
      try {
        renderMessages();
      } finally {
        if (scrollState.followLatest) {
          this.followLatest = true;
          this.messages.scrollTop = this.messages.scrollHeight;
          this.lastMessagesScrollTop = this.messages.scrollTop;
          this.scrollTrackingSuspended = false;
          this.scrollBottom({ force: true });
        } else {
          const maxScrollTop = Math.max(0, this.messages.scrollHeight - this.messages.clientHeight);
          this.messages.scrollTop = Math.min(scrollState.scrollTop, maxScrollTop);
          this.lastMessagesScrollTop = this.messages.scrollTop;
          this.followLatest = !maxScrollTop;
          this.scrollTrackingSuspended = false;
          this.updateScrollLatestButton();
        }
      }
    }

    updateScrollLatestButton() {
      if (!this.scrollLatestBtn) return;
      const hasOverflow = this.messages.scrollHeight > this.messages.clientHeight + CHAT_BOTTOM_FOLLOW_THRESHOLD;
      this.scrollLatestBtn.hidden = this.followLatest || !hasOverflow;
    }

    resumeLatest() {
      this.stopMiddleAutoScroll();
      this.cancelPendingScrollBottom();
      this.followLatest = true;
      this.clearManualScrollIntent();
      this.updateScrollLatestButton();
      this.scrollBottom({ force: true });
    }

    cancelPendingScrollBottom() {
      if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
      if (this.scrollSettleFrame) cancelAnimationFrame(this.scrollSettleFrame);
      if (this.scrollSettleTimer) clearTimeout(this.scrollSettleTimer);
      this.scrollFrame = null;
      this.scrollSettleFrame = null;
      this.scrollSettleTimer = null;
    }

    scrollBottom({ force = false } = {}) {
      if (force) {
        this.cancelPendingScrollBottom();
        this.followLatest = true;
        this.clearManualScrollIntent();
      }
      if (this.scrollTrackingSuspended) return;
      if (!this.followLatest) {
        this.updateScrollLatestButton();
        return;
      }
      const scrollToEnd = () => {
        if (this.scrollTrackingSuspended || !this.followLatest) return;
        this.messages.scrollTop = this.messages.scrollHeight;
        this.lastMessagesScrollTop = this.messages.scrollTop;
        this.updateScrollLatestButton();
      };
      if (force) scrollToEnd();
      if (this.scrollFrame) return;
      this.scrollFrame = requestAnimationFrame(() => {
        this.scrollFrame = null;
        scrollToEnd();
        this.scrollSettleFrame = requestAnimationFrame(() => {
          this.scrollSettleFrame = null;
          scrollToEnd();
        });
        this.scrollSettleTimer = setTimeout(() => {
          this.scrollSettleTimer = null;
          scrollToEnd();
        }, 80);
      });
    }

    startMiddleAutoScroll(event) {
      if (activeMiddleScrollWindow && activeMiddleScrollWindow !== this) {
        activeMiddleScrollWindow.stopMiddleAutoScroll();
      }
      activeMiddleScrollWindow = this;
      this.middleScrollActive = true;
      this.middleScrollAnchorX = event.clientX;
      this.middleScrollAnchorY = event.clientY;
      this.middleScrollPointerX = event.clientX;
      this.middleScrollPointerY = event.clientY;
      this.root.classList.add('chat-middle-autoscrolling');
      document.body.classList.add('chat-middle-autoscroll-active');
      if (this.middleScrollOrigin) {
        const bodyRect = this.messages.parentElement.getBoundingClientRect();
        this.middleScrollOrigin.style.left = `${event.clientX - bodyRect.left}px`;
        this.middleScrollOrigin.style.top = `${event.clientY - bodyRect.top}px`;
        this.middleScrollOrigin.hidden = false;
      }

      const tick = () => {
        if (!this.middleScrollActive) return;
        const distance = this.middleScrollPointerY - this.middleScrollAnchorY;
        if (Math.abs(distance) > CHAT_MIDDLE_SCROLL_DEAD_ZONE) {
          const direction = Math.sign(distance);
          const magnitude = Math.min(
            CHAT_MIDDLE_SCROLL_MAX_SPEED,
            (Math.abs(distance) - CHAT_MIDDLE_SCROLL_DEAD_ZONE) / 5
          );
          this.noteManualScrollIntent(direction);
          this.messages.scrollTop += direction * magnitude;
          const remaining = this.messages.scrollHeight - this.messages.clientHeight - this.messages.scrollTop;
          if (direction > 0 && remaining <= CHAT_BOTTOM_REATTACH_THRESHOLD) {
            this.followLatest = true;
            this.clearManualScrollIntent();
            this.updateScrollLatestButton();
          }
        }
        this.middleScrollFrame = requestAnimationFrame(tick);
      };
      this.middleScrollFrame = requestAnimationFrame(tick);
    }

    stopMiddleAutoScroll() {
      if (!this.middleScrollActive) return;
      this.middleScrollActive = false;
      this.middleScrollPointerDown = false;
      this.middleScrollGestureMoved = false;
      if (this.middleScrollFrame) cancelAnimationFrame(this.middleScrollFrame);
      this.middleScrollFrame = null;
      this.root.classList.remove('chat-middle-autoscrolling');
      if (this.middleScrollOrigin) this.middleScrollOrigin.hidden = true;
      if (activeMiddleScrollWindow === this) {
        activeMiddleScrollWindow = null;
        document.body.classList.remove('chat-middle-autoscroll-active');
      }
    }

    stopHermesProgressTimers() {
      if (!this.hermesProgressTimers?.length) return;
      for (const timer of this.hermesProgressTimers) clearTimeout(timer);
      this.hermesProgressTimers = [];
    }

    async sendHermesBlockingMessage(hermesBody, hermesProgress) {
      this.startHermesLivePolling(hermesProgress);
      try {
        const resp = await fetch('/api/hermes/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(hermesBody)
        });
        const data = await resp.json();
        this.stopHermesLivePolling();
        this.removeTypingIndicator();
        const hermesTools = normalizeHermesTools(data.tools || []);
        const hasRenderableHermesReply = !!(data.reply || data.thinking || data.reasoningTokens || data.approval || hermesTools.length);
        if (!resp.ok || data.ok === false) {
          if (!hasRenderableHermesReply) throw new Error(data.error || data.reply || resp.statusText);
        }
        this.finishHermesProgress(hermesProgress, true);
        const runId = this.currentRunId || hermesProgress?.runId || `hermes-blocking-${Date.now()}`;
        if (data.thinking) this.applyDistinctThinking(runId, data.thinking);
        hermesTools.forEach(tool => this.applyTurnEvent({ kind: 'tool.result', runId, tool: { ...tool, runId } }));
        if (data.approval) this.applyTurnEvent({ kind: 'approval', runId, approval: data.approval, provider: 'hermes' });
        if (data.reply) this.applyTurnEvent({ kind: 'text.replace', runId, text: data.reply });
        this.applyTurnEvent({ kind: 'run.complete', runId });
        await this.pollHermesApproval().catch(() => {});
      } catch (e) {
        this.stopHermesLivePolling();
        throw e;
      }
    }

    async sendCodexBlockingMessage(codexBody, codexLabel = 'Codex') {
      const resp = await fetch('/api/codex/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(codexBody)
      });
      const data = await resp.json();
      this.removeTypingIndicator();
      const codexTools = normalizeHermesTools(data.tools || []);
      const hasRenderableReply = !!(data.reply || data.thinking || data.reasoningTokens || codexTools.length);
      if (!resp.ok || data.ok === false) {
        if (!hasRenderableReply) throw new Error(data.error || data.reply || resp.statusText);
      }
      const runId = this.currentRunId || `codex-blocking-${Date.now()}`;
      if (data.thinking) this.applyDistinctThinking(runId, data.thinking);
      codexTools.forEach(tool => this.applyTurnEvent({ kind: 'tool.result', runId, tool: { ...tool, runId } }));
      if (data.approval) this.applyTurnEvent({ kind: 'approval', runId, approval: data.approval, provider: 'codex' });
      if (data.reply) this.applyTurnEvent({ kind: 'text.replace', runId, text: data.reply });
      this.applyTurnEvent({ kind: 'run.complete', runId });
    }

    streamNativeRunEvents(provider, runId) {
      const cfg = NATIVE_PROVIDER_UI[provider];
      if (!cfg || !runId) return Promise.reject(new Error(`${cfg?.label || provider} run did not return a run id`));
      this.closeNativeEventSource(provider);
      this[cfg.completedKeysProperty] = new Set();
      this.currentRunId = runId;
      this.markLiveEvent();
      const agentId = this.getSelectedAgentId() || this.selectedAgentKey || '';
      const url = '/api/' + cfg.path + '/runs/' + encodeURIComponent(runId) + '/events?agentId=' + encodeURIComponent(agentId);
      const terminalEvents = new Set(['run.completed', 'run.failed', 'run.cancelled', 'run.canceled']);
      return new Promise((resolve, reject) => {
        let settled = false;
        const source = new EventSource(url);
        this[cfg.sourceProperty] = source;
        const cleanup = () => {
          if (this[cfg.sourceProperty] === source) this[cfg.sourceProperty] = null;
          source.close();
        };
        const finish = (ok, value) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (ok) resolve(value);
          else reject(value instanceof Error ? value : new Error(String(value || cfg.label + ' stream failed')));
        };
        const handle = (eventName, event) => {
          let data = {};
          try { data = JSON.parse(event.data || '{}'); } catch (_) {}
          this.handleNativeRunEvent(provider, eventName, data);
          if (terminalEvents.has(eventName)) {
            if (eventName === 'run.completed') finish(true, data);
            else {
              const error = new Error(data.error || eventName);
              error.turnReducerHandled = true;
              finish(false, error);
            }
          }
        };
        [
          'run.started',
          'session.metrics',
          'message.delta',
          'reasoning.available',
          'tool.started',
          'tool.updated',
          'tool.completed',
          'tool.failed',
          'approval.request',
          'run.completed',
          'run.failed',
          'run.cancelled',
          'run.canceled'
        ].forEach(name => source.addEventListener(name, event => handle(name, event)));
        source.onmessage = event => handle('message', event);
        source.onerror = () => {
          if (!settled) {
            const error = cfg.label + ' native stream disconnected';
            this.applyTurnEvent({ kind: 'run.failed', runId, error });
            const failure = new Error(error);
            failure.turnReducerHandled = true;
            finish(false, failure);
          }
        };
      });
    }

    handleNativeRunEvent(provider, eventName, data) {
      const cfg = NATIVE_PROVIDER_UI[provider];
      if (!cfg) return;
      this.markLiveEvent();
      this.applyContextUsage(data || {});
      const runId = data?.runId || this.currentRunId || '';
      if (runId) this.currentRunId = runId;

      if (eventName === 'run.started') {
        this.applyTurnEvent({ kind: 'run.start', runId, label: cfg.label + ' is running...' });
        if (provider !== 'hermes') this.fetchSessionInfo().catch(() => {});
        return;
      }
      if (eventName === 'session.metrics') return;
      if (eventName === 'message.delta') {
        if (data.reply) this.applyTurnEvent({ kind: 'text.replace', runId, text: data.reply });
        else if (data.delta) this.applyTurnEvent({ kind: 'text.delta', runId, text: data.delta });
        return;
      }
      if (eventName === 'reasoning.available') {
        const thinking = data.thinking || data.text || '';
        if (this.applyDistinctThinking(runId, thinking)) this.updateTypingIndicator(cfg.label + ' is reasoning...');
        return;
      }
      if (eventName === 'approval.request') {
        if (data.approval) {
          const approval = { ...data.approval, pending_count: data.pending_count || data.approval.pending_count || 1 };
          this.applyTurnEvent({ kind: 'approval', runId, approval, provider: cfg.approval || provider });
        }
        this.updateTypingIndicator(cfg.label + ' is waiting for approval...');
        return;
      }
      if (['tool.started', 'tool.updated', 'tool.completed', 'tool.failed'].includes(eventName)) {
        const card = data.toolCard || {};
        const isTerminal = eventName === 'tool.completed' || eventName === 'tool.failed';
        const tool = {
          id: card.id || data.toolCallId || data.id || '',
          runId,
          status: eventName === 'tool.failed' || card.status === 'error' || data.error ? 'error' : (isTerminal ? 'done' : 'running'),
          name: card.name || data.tool || data.name || cfg.label + ' tool',
          arguments: card.arguments || (card.args_preview ? { command: card.args_preview } : (data.preview || {})),
          result: card.result || data.result || data.output || '',
          error: data.error || card.error || ''
        };
        const kind = isTerminal ? 'tool.result' : (eventName === 'tool.updated' ? 'tool.update' : 'tool.start');
        this.updateTypingIndicator(isTerminal ? 'Processing...' : formatToolLabel(tool.name, coerceToolArgs(tool.arguments)));
        this.applyTurnEvent({ kind, runId, tool });
        return;
      }
      if (['run.completed', 'run.failed', 'run.cancelled', 'run.canceled'].includes(eventName)) {
        const finalText = data.reply || data.output || '';
        if (finalText) this.applyTurnEvent({ kind: 'text.replace', runId, text: finalText });
        const kind = eventName === 'run.completed' ? 'run.complete' : (eventName === 'run.failed' ? 'run.failed' : 'run.cancelled');
        this.applyTurnEvent({ kind, runId, error: data.error || '' });
        if (provider !== 'hermes') this.fetchSessionInfo().catch(() => {});
      }
    }

    streamHermesRunEvents(runId, hermesProgress) {
      return this.streamNativeRunEvents('hermes', runId).finally(() => this.finishHermesProgress(hermesProgress, true));
      /* Legacy body retained below only until all downstream extensions move
         to the provider-neutral adapter; execution returns above. */
      if (!runId) return Promise.reject(new Error('Hermes run did not return a run id'));
      this.closeHermesEventSource();
      this.hermesCompletedToolKeys = new Set();
      this.currentRunId = runId;
      this.markLiveEvent();
      const agentId = this.getSelectedAgentId() || this.selectedAgentKey || '';
      const url = '/api/hermes/runs/' + encodeURIComponent(runId) + '/events?agentId=' + encodeURIComponent(agentId);
      return new Promise((resolve, reject) => {
        let settled = false;
        const source = new EventSource(url);
        this.hermesEventSource = source;
        const cleanup = () => {
          if (this.hermesEventSource === source) this.hermesEventSource = null;
          source.close();
        };
        const finish = (ok, value) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (ok) resolve(value);
          else reject(value instanceof Error ? value : new Error(String(value || 'Hermes stream failed')));
        };
        const handle = (eventName, evt) => {
          let data = {};
          try { data = JSON.parse(evt.data || '{}'); } catch (_) {}
          this.handleHermesNativeEvent(eventName, data);
          if (['run.completed', 'run.failed', 'run.cancelled', 'run.canceled'].includes(eventName)) {
            finish(eventName === 'run.completed', eventName === 'run.completed' ? data : new Error(data.error || eventName));
          }
        };
        [
          'run.started',
          'message.delta',
          'reasoning.available',
          'tool.started',
          'tool.completed',
          'tool.failed',
          'approval.request',
          'run.completed',
          'run.failed',
          'run.cancelled',
          'run.canceled'
        ].forEach(name => source.addEventListener(name, evt => handle(name, evt)));
        source.onmessage = evt => handle('message', evt);
        source.onerror = () => {
          if (!settled) finish(false, new Error('Hermes native stream disconnected'));
        };
      }).finally(() => {
        this.finishHermesProgress(hermesProgress, true);
      });
    }

    handleHermesNativeEvent(eventName, data) {
      return this.handleNativeRunEvent('hermes', eventName, data);
      /* Legacy body retained for downstream compatibility; execution returns above. */
      this.markLiveEvent();
      const runId = data?.runId || this.currentRunId || '';
      if (runId) this.currentRunId = runId;

      if (eventName === 'run.started') {
        this.updateTypingIndicator('Hermes is running...');
        return;
      }

      if (eventName === 'message.delta') {
        if (!this.streamingMsg || this.streamingMsg.id !== runId) {
          this.streamingMsg = { id: runId, role: 'assistant', content: '' };
          this.appendStreamingMessage();
        }
        this.streamingMsg.content = data.reply || (this.streamingMsg.content + String(data.delta || ''));
        this.updateStreamingMessage(this.streamingMsg.content);
        this.scrollBottom();
        return;
      }

      if (eventName === 'reasoning.available') {
        this.updateTypingIndicator('Hermes is reasoning...');
        return;
      }

      if (eventName === 'approval.request') {
        if (data.approval) this.appendHermesPendingApproval(data.approval, data.pending_count || 1);
        this.updateTypingIndicator('Hermes is waiting for approval...');
        return;
      }

      if (eventName === 'tool.started' || eventName === 'tool.completed' || eventName === 'tool.failed') {
        const card = data.toolCard || {};
        const isTerminal = eventName !== 'tool.started';
        const payload = {
          runId,
          data: {
            toolCallId: card.id || data.toolCallId || data.id || '',
            phase: isTerminal ? 'result' : 'start',
            name: card.name || data.tool || data.name || 'Hermes tool',
            args: card.arguments || (card.args_preview ? { command: card.args_preview } : (data.preview ? { command: data.preview } : {})),
            result: card.result || data.result || data.output || '',
            isError: eventName === 'tool.failed' || card.status === 'error' || !!data.error,
            error: data.error || card.error || ''
          }
        };
        const label = formatToolLabel(payload.data.name, coerceToolArgs(payload.data.args));
        this.updateTypingIndicator(isTerminal ? 'Processing...' : label);
        if (isTerminal) {
          if (!this.liveToolCards.has(this.toolKey(payload))) {
            this.appendToolCall({ ...payload, data: { ...payload.data, phase: 'start' } });
          }
          this.finishToolCall(payload);
        } else {
          this.updateToolCall(payload);
        }
        return;
      }

      if (['run.completed', 'run.failed', 'run.cancelled', 'run.canceled'].includes(eventName)) {
        const finalText = data.reply || data.output || (this.streamingMsg ? this.streamingMsg.content : '');
        this.flushToolEvents(true);
        this.clearActivityFeed();
        this.removeTypingIndicator();
        if (this.streamingMsg) {
          this.finalizeStreamingMessage(finalText);
          this.streamingMsg = null;
        } else if (finalText) {
          this.appendMessage('assistant', finalText);
        }
        if (runId) this.finalizeRunToolCards(runId);
        this.currentRunId = null;
      }
    }

    streamCodexRunEvents(runId) {
      return this.streamNativeRunEvents('codex', runId);
      /* Legacy body retained for downstream compatibility; execution returns above. */
      if (!runId) return Promise.reject(new Error('Codex run did not return a run id'));
      this.closeCodexEventSource();
      this.currentRunId = runId;
      this.markLiveEvent();
      const agentId = this.getSelectedAgentId() || this.selectedAgentKey || '';
      const url = '/api/codex/runs/' + encodeURIComponent(runId) + '/events?agentId=' + encodeURIComponent(agentId);
      return new Promise((resolve, reject) => {
        let settled = false;
        const source = new EventSource(url);
        this.codexEventSource = source;
        const cleanup = () => {
          if (this.codexEventSource === source) this.codexEventSource = null;
          source.close();
        };
        const finish = (ok, value) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (ok) resolve(value);
          else reject(value instanceof Error ? value : new Error(String(value || 'Codex stream failed')));
        };
        const handle = (eventName, evt) => {
          let data = {};
          try { data = JSON.parse(evt.data || '{}'); } catch (_) {}
          this.handleCodexNativeEvent(eventName, data);
          if (['run.completed', 'run.failed', 'run.cancelled', 'run.canceled'].includes(eventName)) {
            finish(eventName === 'run.completed', eventName === 'run.completed' ? data : new Error(data.error || eventName));
          }
        };
        [
          'run.started',
          'message.delta',
          'reasoning.available',
          'tool.started',
          'tool.updated',
          'tool.completed',
          'tool.failed',
          'approval.request',
          'run.completed',
          'run.failed',
          'run.cancelled',
          'run.canceled'
        ].forEach(name => source.addEventListener(name, evt => handle(name, evt)));
        source.onmessage = evt => handle('message', evt);
        source.onerror = () => {
          if (!settled) finish(false, new Error('Codex stream disconnected'));
        };
      });
    }

    handleCodexNativeEvent(eventName, data) {
      return this.handleNativeRunEvent('codex', eventName, data);
      /* Legacy body retained for downstream compatibility; execution returns above. */
      this.markLiveEvent();
      const runId = data?.runId || this.currentRunId || '';
      if (runId) this.currentRunId = runId;

      if (eventName === 'run.started') {
        this.updateTypingIndicator('Codex is running...');
        return;
      }

      if (eventName === 'message.delta') {
        if (!this.streamingMsg || this.streamingMsg.id !== runId) {
          this.streamingMsg = { id: runId, role: 'assistant', content: '' };
          this.appendStreamingMessage();
        }
        this.streamingMsg.content = data.reply || (this.streamingMsg.content + String(data.delta || ''));
        this.updateStreamingMessage(this.streamingMsg.content);
        this.scrollBottom();
        return;
      }

      if (eventName === 'reasoning.available') {
        this.updateTypingIndicator('Codex is reasoning...');
        return;
      }

      if (eventName === 'approval.request') {
        if (data.approval) this.appendCodexPendingApproval(data.approval, data.pending_count || 1);
        this.updateTypingIndicator('Codex requested input...');
        return;
      }

      if (['tool.started', 'tool.updated', 'tool.completed', 'tool.failed'].includes(eventName)) {
        const card = data.toolCard || {};
        const isTerminal = eventName === 'tool.completed' || eventName === 'tool.failed';
        const payload = {
          runId,
          data: {
            toolCallId: card.id || data.toolCallId || data.id || '',
            phase: isTerminal ? 'result' : eventName === 'tool.updated' ? 'update' : 'start',
            name: card.name || data.tool || data.name || 'Codex tool',
            args: card.arguments || data.preview || {},
            result: card.result || data.result || data.output || '',
            isError: eventName === 'tool.failed' || card.status === 'error' || !!data.error,
            error: data.error || card.error || ''
          }
        };
        const label = formatToolLabel(payload.data.name, coerceToolArgs(payload.data.args));
        this.updateTypingIndicator(isTerminal ? 'Processing...' : label);
        if (isTerminal) {
          if (!this.liveToolCards.has(this.toolKey(payload))) {
            this.appendToolCall({ ...payload, data: { ...payload.data, phase: 'start' } });
          }
          this.finishToolCall(payload);
        } else {
          this.updateToolCall(payload);
        }
        return;
      }

      if (['run.completed', 'run.failed', 'run.cancelled', 'run.canceled'].includes(eventName)) {
        this.applyContextUsage(data);
        const finalText = data.reply || data.output || (this.streamingMsg ? this.streamingMsg.content : '');
        this.flushToolEvents(true);
        this.clearActivityFeed();
        this.removeTypingIndicator();
        if (this.streamingMsg) {
          this.finalizeStreamingMessage(finalText);
          this.streamingMsg = null;
        } else if (finalText) {
          this.appendMessage('assistant', finalText);
        }
        if (runId) this.finalizeRunToolCards(runId);
        this.currentRunId = null;
        this.fetchSessionInfo();
      }
    }

    streamProviderSdkRun(runId, providerLabel = 'Provider') {
      if (!runId) return Promise.reject(new Error('Provider SDK run did not return a run id'));
      this.closeProviderEventSource();
      this.currentRunId = runId;
      const source = new EventSource('/api/providers/runs/' + encodeURIComponent(runId) + '/events');
      this.providerEventSource = source;
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (ok, value) => {
          if (settled) return;
          settled = true;
          if (this.providerEventSource === source) this.providerEventSource = null;
          source.close();
          if (ok) resolve(value);
          else reject(value instanceof Error ? value : new Error(String(value || 'Provider SDK stream failed')));
        };
        const handle = (eventName, event) => {
          let data = {};
          try { data = JSON.parse(event.data || '{}'); } catch (_) {}
          this.handleProviderSdkEvent(eventName, { ...data, runId: data.runId || runId, providerLabel });
          if (['run.completed', 'run.failed', 'run.cancelled', 'run.canceled'].includes(eventName)) {
            if (eventName === 'run.completed') finish(true, data);
            else {
              const error = new Error(data.error || eventName);
              error.turnReducerHandled = true;
              finish(false, error);
            }
          }
        };
        ['run.started', 'turn.progress', 'run.completed', 'run.failed', 'run.cancelled', 'run.canceled']
          .forEach(name => source.addEventListener(name, event => handle(name, event)));
        source.onerror = () => { if (!settled) finish(false, new Error(`${providerLabel} stream disconnected`)); };
      });
    }

    handleProviderSdkEvent(eventName, data) {
      this.markLiveEvent();
      this.applyContextUsage(data || {});
      const runId = data?.runId || this.currentRunId || '';
      if (runId) this.currentRunId = runId;
      const providerKind = this.getSelectedProviderKind();
      const providerLabel = data?.providerLabel || this.agentSelect?.selectedOptions?.[0]?.textContent.trim() || providerKind || 'Provider';

      if (eventName === 'run.started') {
        this.applyTurnEvent({ kind: 'run.start', runId, label: providerLabel + ' is starting…' });
      }

      const thinking = String(data?.thinking || '').trim();
      if (thinking && this.turnEvents.get(runId)?.thinkingText !== thinking) {
        this.applyDistinctThinking(runId, thinking);
        this.updateTypingIndicator(providerLabel + ' is working…');
      }

      const commentary = String(data?.commentary || '').trim();
      if (commentary) {
        const commentaryKey = `sdk:${runId}:${commentary}`;
        if (!this.seenOpenClawCommentary.has(commentaryKey)) {
          this.seenOpenClawCommentary.add(commentaryKey);
          this.applyTurnEvent({ kind: 'commentary', runId, text: commentary });
        }
      }

      for (const card of (Array.isArray(data?.tools) ? data.tools : [])) {
        if (!card || typeof card !== 'object') continue;
        const status = String(card.status || '').toLowerCase();
        const terminal = ['done', 'completed', 'complete', 'success', 'succeeded', 'error', 'failed', 'cancelled', 'canceled'].includes(status);
        const tool = {
          runId,
          id: card.id || card.toolCallId || card.callId || '',
          name: card.name || card.tool || 'Provider tool',
          status: ['error', 'failed'].includes(status) || card.error ? 'error' : (terminal ? 'done' : 'running'),
          arguments: card.arguments || card.args || {},
          result: card.result || card.output || '',
          error: card.error || ''
        };
        const key = ChatEvents.toolIdentity(tool);
        const existing = key ? this.turnEvents.get(runId)?.tools?.get(key) : null;
        const kind = terminal ? 'tool.result' : (existing ? 'tool.update' : 'tool.start');
        const label = formatToolLabel(tool.name, coerceToolArgs(tool.arguments));
        this.updateTypingIndicator(terminal ? 'Processing...' : label);
        this.applyTurnEvent({ kind, runId, tool });
      }

      const reply = String(data?.reply || '');
      if (reply) this.applyTurnEvent({ kind: 'text.replace', runId, text: reply });

      if (data?.approval) {
        this.applyTurnEvent({
          kind: 'approval',
          runId,
          approval: { ...data.approval, pending_count: data.pending_count || data.approval.pending_count || 1 },
          provider: providerKind
        });
        this.updateTypingIndicator(providerLabel + ' is waiting for approval…');
      }

      if (['run.completed', 'run.failed', 'run.cancelled', 'run.canceled'].includes(eventName)) {
        const kind = eventName === 'run.completed'
          ? 'run.complete'
          : (eventName === 'run.failed' ? 'run.failed' : 'run.cancelled');
        this.applyTurnEvent({ kind, runId, error: data?.error || '' });
        this.fetchSessionInfo().catch(() => {});
        this.refreshSessionsList().catch(() => {});
      }
    }

    stopHermesLivePolling() {
      if (this.hermesLivePollTimer) {
        clearInterval(this.hermesLivePollTimer);
        this.hermesLivePollTimer = null;
      }
    }

    startHermesLivePolling(progress) {
      this.stopHermesLivePolling();
      this.hermesLiveEventSeq = 0;
      if (!progress?.runId) return;
      const poll = async () => {
        try {
          const res = await fetch('/api/hermes/live?runId=' + encodeURIComponent(progress.runId) + '&since=' + encodeURIComponent(String(this.hermesLiveEventSeq || 0)));
          const data = await res.json();
          if (!data.ok || !Array.isArray(data.events)) return;
          for (const event of data.events) {
            this.hermesLiveEventSeq = Math.max(this.hermesLiveEventSeq || 0, Number(event.seq || 0));
            this.handleHermesLiveEvent(progress, event);
          }
        } catch (_) {}
      };
      poll();
      this.hermesLivePollTimer = setInterval(poll, 250);
    }

    handleHermesLiveEvent(progress, event) {
      const payload = event?.payload || {};
      if (event?.type === 'activity') {
        const tools = normalizeHermesTools(payload.tools || []);
        for (const tool of tools) {
          const toolId = tool.id || tool.name || progress.planId;
          const livePayload = {
            runId: progress.runId,
            data: {
              toolCallId: toolId,
              phase: tool.status === 'done' || tool.status === 'error' ? 'result' : 'update',
              name: tool.name || 'Hermes activity',
              args: tool.arguments || {},
              result: tool.result || '',
              partialResult: tool.result || '',
              isError: tool.status === 'error'
            }
          };
          if (tool.status === 'done' || tool.status === 'error') {
            const key = this.toolKey(livePayload);
            if (!this.liveToolCards.has(key)) {
              this.appendToolCall({
                runId: progress.runId,
                data: {
                  toolCallId: toolId,
                  phase: 'start',
                  name: tool.name || 'Hermes activity',
                  args: tool.arguments || {},
                  result: ''
                }
              });
            }
            this.finishToolCall(livePayload);
          } else {
            this.updateToolCall(livePayload);
          }
        }
        if (payload.thinking) {
          this.updateTypingIndicator((progress.label || 'Hermes') + ' is thinking...');
        }
      } else if (event?.type === 'approval' && payload.approval) {
        this.appendHermesPendingApproval(payload.approval, payload.pending_count || 1);
      } else if (event?.type === 'final') {
        if (payload.approval) this.appendHermesPendingApproval(payload.approval, 1);
      }
    }

    async recoverHermesFinalFromHistory(startedAt, timeoutMs = 45000) {
      if (!this.isHermesSelected()) return false;
      const deadline = Date.now() + timeoutMs;
      const agentId = this.getSelectedAgentId() || this.selectedAgentKey;
      while (Date.now() < deadline) {
        const res = await fetch('/api/hermes/history?agentId=' + encodeURIComponent(agentId));
        const data = await res.json();
        if (data.ok && Array.isArray(data.messages)) {
          const finalMsg = [...data.messages].reverse().find(msg =>
            msg &&
            msg.role === 'assistant' &&
            msg.ephemeral !== 'hermes-progress' &&
            (msg.text || msg.approval) &&
            Number(msg.ts || msg.epochMs || 0) >= Number(startedAt || 0)
          );
          if (finalMsg) {
            if (this.streamingMsg) {
              const existing = this.messages.querySelector('.streaming-msg');
              if (existing) existing.remove();
              this.streamingMsg = null;
            }
            await this.loadHistory({ recoverFinal: true });
            return true;
          }
        }
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
      return false;
    }

    startHermesProgress(label) {
      this.stopHermesProgressTimers();
      const runId = 'hermes-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      this.currentRunId = runId;
      this.updateTypingIndicator(label + ' is running Hermes');
      return { runId, label };
    }

    finishHermesProgress(progress, ok, errorText = '') {
      if (!progress) return;
      this.stopHermesProgressTimers();
      this.stopHermesLivePolling();
      if (this.currentRunId === progress.runId) this.currentRunId = null;
    }

    async respondHermesApproval(approval, choice, card) {
      if (!approval || !this.isHermesSelected()) return;
      const buttons = card ? [...card.querySelectorAll('button')] : [];
      buttons.forEach(btn => btn.disabled = true);
      if (card) card.classList.add('responding');
      try {
        const resp = await fetch('/api/hermes/approval/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approval,
            choice,
            agentId: this.getSelectedAgentId() || this.selectedAgentKey,
            fromDisplayName: 'User'
          })
        });
        const data = await resp.json();
        if (!resp.ok || data.ok === false) throw new Error(data.error || data.reply || resp.statusText);
        if (choice === 'approve_once') {
          if (card) {
            card.classList.remove('pending', 'responding');
            card.classList.add('approved');
            const status = card.querySelector('.chat-approval-status');
            if (status) status.textContent = 'approved';
          }
          if (data.providerPath !== 'api') {
            this.appendMessage(
              'assistant',
              data.reply || '',
              Date.now(),
              [],
              {
                label: this.agentSelect.selectedOptions[0]?.textContent.trim() || 'Hermes',
                kind: 'agent',
                thinking: data.thinking || '',
                reasoningTokens: data.reasoningTokens || 0,
                approval: data.approval || null
              },
              normalizeHermesTools(data.tools || [])
            );
          } else {
            this.updateTypingIndicator('Hermes is continuing...');
          }
          await this.pollHermesApproval().catch(() => {});
        } else {
          if (card) {
            card.classList.remove('pending', 'responding');
            card.classList.add('denied');
            const status = card.querySelector('.chat-approval-status');
            if (status) status.textContent = 'denied';
          }
          this.appendSystem('Hermes approval denied.');
          await this.pollHermesApproval().catch(() => {});
        }
        this.scrollBottom();
      } catch (e) {
        buttons.forEach(btn => btn.disabled = false);
        if (card) {
          card.classList.remove('responding');
          const status = card.querySelector('.chat-approval-status');
          if (status) status.textContent = 'error';
        }
        this.showRunNotice('Approval failed', e.message, this.currentRunId);
      }
    }

    async respondProviderApproval(approval, choice, card) {
      if (!approval || !this.supportsProviderApprovals()) return;
      const buttons = card ? [...card.querySelectorAll('button')] : [];
      buttons.forEach(button => { button.disabled = true; });
      card?.classList.add('responding');
      try {
        const response = await fetch('/api/providers/approvals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: this.getSelectedAgentId() || this.selectedAgentKey,
            approval,
            approvalId: approval.approval_id || approval.id,
            choice
          })
        });
        const data = await response.json();
        if (!response.ok || data.ok === false) throw new Error(data.error || response.statusText);
        const approved = ['approve', 'approved', 'accept', 'allow', 'approve_once', 'allow_once'].includes(String(choice).toLowerCase());
        if (card) {
          card.classList.remove('pending', 'responding');
          card.classList.add(approved ? 'approved' : 'denied');
          const status = card.querySelector('.chat-approval-status');
          if (status) status.textContent = approved ? 'approved' : 'denied';
        }
        await this.pollCodexApproval().catch(() => {});
      } catch (error) {
        buttons.forEach(button => { button.disabled = false; });
        card?.classList.remove('responding');
        const status = card?.querySelector('.chat-approval-status');
        if (status) status.textContent = 'error';
        this.showRunNotice('Approval failed', error.message, this.currentRunId);
      }
    }

    toolKey(payload) {
      const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
      const id = data.toolCallId || data.itemId || payload?.toolCallId || payload?.callId || payload?.itemId || payload?.id;
      const runId = payload?.runId || data.runId || this.currentRunId || 'run';
      const name = data.name || payload?.name || payload?.tool || payload?.toolName || 'tool';
      return id || `${runId}:${name}:${this.liveToolCards.size}`;
    }

    appendToolCall(payload) {
      const tool = normalizeToolEvent(payload, 'running');
      const key = this.toolKey(payload);
      tool.key = key;
      const existing = this.liveToolCards.get(key);
      if (existing) {
        updateToolCallCard(existing.querySelector('.chat-tool-call'), tool);
        return;
      }
      const wrap = document.createElement('div');
      wrap.className = 'chat-msg assistant chat-tool-msg';
      wrap.dataset.runId = payload?.runId || tool.runId || this.currentRunId || '';
      wrap.dataset.toolKey = key;
      wrap.appendChild(renderToolCallCard(tool, { live: true }));
      const ind = this.messages.querySelector('.typing-indicator');
      if (ind) this.messages.insertBefore(wrap, ind);
      else this.messages.appendChild(wrap);
      this.liveToolCards.set(key, wrap);
      this.pruneToolCards();
      this.scrollBottom();
    }

    updateToolCall(payload) {
      const key = this.toolKey(payload);
      const wrap = this.liveToolCards.get(key);
      if (!wrap) return this.appendToolCall(payload);
      updateToolCallCard(wrap.querySelector('.chat-tool-call'), normalizeToolEvent(payload, 'running'));
      this.scrollBottom();
    }

    finishToolCall(payload) {
      let key = this.toolKey(payload);
      let wrap = this.liveToolCards.get(key);
      if (!wrap && this.liveToolCards.size) {
        const sameRun = [...this.liveToolCards.entries()].reverse().find(([, el]) => !payload?.runId || el.dataset.runId === payload.runId);
        if (sameRun) { key = sameRun[0]; wrap = sameRun[1]; }
      }
      if (!wrap) return;
      const tool = normalizeToolEvent(payload, payload?.error ? 'error' : 'done');
      const card = wrap.querySelector('.chat-tool-call');
      updateToolCallCard(card, tool);
      this.liveToolCards.delete(key);
      this.scrollBottom();
    }

    finalizeRunToolCards(runId, runStatus = 'completed', errorText = '') {
      for (const [key, wrap] of [...this.liveToolCards.entries()]) {
        if (!runId || wrap.dataset.runId === runId) {
          const failed = runStatus === 'failed';
          const result = runStatus === 'cancelled' ? 'Cancelled' : 'Completed';
          updateToolCallCard(wrap.querySelector('.chat-tool-call'), failed
            ? { status: 'error', error: errorText || 'Run failed' }
            : { status: 'done', result });
          this.liveToolCards.delete(key);
        }
      }
    }

    pruneToolCards() {
      const cards = [...this.messages.querySelectorAll('.chat-tool-msg')];
      const extra = cards.length - MAX_LIVE_TOOL_CARDS;
      if (extra <= 0) return;
      for (const el of cards.slice(0, extra)) {
        const key = el.dataset.toolKey;
        if (key) this.liveToolCards.delete(key);
        el.remove();
      }
      let notice = this.messages.querySelector('.chat-tool-pruned-notice');
      if (!notice) {
        notice = document.createElement('div');
        notice.className = 'chat-msg system chat-tool-pruned-notice';
        notice.innerHTML = '<div class="chat-bubble system-bubble">Earlier live tool activity was collapsed to keep the chat responsive.</div>';
        this.messages.prepend(notice);
      }
    }

    updateLiveThinking(runId, text) {
      const cleaned = String(text || '').trim();
      if (!cleaned) return;
      const key = runId || this.currentRunId || 'provider-run';
      if (!this.liveThinkingEl || this.liveThinkingRunId !== key || !this.liveThinkingEl.isConnected) {
        const wrap = document.createElement('div');
        wrap.className = 'chat-msg assistant chat-thinking-live';
        wrap.dataset.runId = key;
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble';
        const card = renderThinkingCard(cleaned);
        card.open = true;
        bubble.appendChild(card);
        wrap.appendChild(bubble);
        const indicator = this.messages.querySelector('.typing-indicator');
        if (indicator) this.messages.insertBefore(wrap, indicator);
        else this.messages.appendChild(wrap);
        this.liveThinkingEl = wrap;
        this.liveThinkingPre = card.querySelector('.chat-thinking-body pre');
        this.liveThinkingRunId = key;
      } else if (this.liveThinkingPre) {
        this.liveThinkingPre.textContent = cleaned;
      }
      this.scrollBottom();
    }

    appendActivity(text) {
      const existing = this.messages.querySelectorAll('.chat-activity');
      if (existing.length >= 8) existing[0].remove();
      const div = document.createElement('div');
      div.className = 'chat-activity';
      div.innerHTML = '<span class="activity-text">' + escHtml(text) + '</span><span class="activity-time">' + new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}) + '</span>';
      const ind = this.messages.querySelector('.typing-indicator');
      if (ind) this.messages.insertBefore(div, ind);
      else this.messages.appendChild(div);
      this.scrollBottom();
    }
  }

  function buildSecondaryChatPanel(slotNum) {
    const placeholder = secondaryPanelPlaceholders[slotNum];
    const primaryPanel = document.getElementById('chat-panel');
    if (!placeholder || !primaryPanel) return null;
    const panel = primaryPanel.cloneNode(true);
    panel.id = `chat-secondary-${slotNum}`;
    panel.dataset.chatSlot = `secondary-${slotNum}`;
    panel.classList.remove('open', 'floating', 'dragging', 'move-active', 'snap-left', 'snap-right');
    panel.classList.add('chat-panel-secondary');
    panel.setAttribute('aria-hidden', 'true');
    panel.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    panel.querySelector('.chat-secondary-controls')?.remove();
    panel.querySelector('.chat-exterior-tabs')?.remove();

    const header = panel.querySelector('.chat-header');
    header.classList.add('chat-secondary-header');
    const headerBtns = panel.querySelector('.chat-header-btns');
    if (headerBtns) {
      const badge = document.createElement('span');
      badge.className = 'chat-secondary-badge';
      badge.textContent = `W${slotNum}`;
      header.insertBefore(badge, headerBtns);
    }
    const closeBtn = panel.querySelector('.chat-close');
    if (closeBtn) {
      closeBtn.classList.add('chat-secondary-close');
      closeBtn.dataset.chatSlotClose = String(slotNum);
      closeBtn.title = `Hide secondary chat window ${slotNum}`;
    }
    placeholder.replaceWith(panel);
    return panel;
  }

  function updateChatStackLayout() {
    const root = document.documentElement;
    const dockRight = typeof _getChatDockRightOffset === 'function' ? _getChatDockRightOffset() : 92;
    root.style.setProperty('--chat-stack-gap', CHAT_STACK_GAP + 'px');
    root.style.setProperty('--chat-stack-main-right', dockRight + 'px');
    _tileSecondaryPanels();
  }

  /**
   * Tile all open secondary panels to the left of the main panel.
   * Order: Main | 1 | 2 | 3 (right to left).
   * Only sets horizontal position + width. Height is independent per panel.
   * New panels get the main panel's height; existing panels keep theirs.
   */
  let _tileRafPending = false;
  function _tileSecondaryPanels() {
    if (_tileRafPending) return;
    _tileRafPending = true;
    requestAnimationFrame(_tileSecondaryPanelsNow);
  }
  function _tileSecondaryPanelsNow() {
    _tileRafPending = false;
    if (Object.values(secondaryChatPanels).some(p => p?.dataset.resizeActive === '1')) return;
    const mainPanel = document.getElementById('chat-panel');
    if (!mainPanel || !mainPanel.classList.contains('open')) return;

    const GAP = CHAT_STACK_GAP;
    const MIN_W = 160;

    const mainRect = mainPanel.getBoundingClientRect();
    const mainLeft = mainRect.left;

    // Collect open secondary panels in order (1, 2, 3)
    const openSecondaries = [];
    [1, 2, 3].forEach((slotNum) => {
      const p = secondaryChatPanels[String(slotNum)];
      if (p && p.classList.contains('open')) openSecondaries.push(p);
    });

    if (openSecondaries.length === 0) return;

    // Available space to the left of the main panel
    const availableLeft = mainLeft - GAP;
    const totalGaps = (openSecondaries.length - 1) * GAP;
    const defaultSecWidth = Math.max(MIN_W, Math.floor((availableLeft - totalGaps) / openSecondaries.length));

    // Position each open secondary from right to left, starting just left of main
    let cursor = mainLeft - GAP;
    openSecondaries.forEach((panel) => {
      const currentWidth = panel.getBoundingClientRect().width;
      const secWidth = panel.dataset.hasCustomWidth ? Math.max(MIN_W, Math.round(currentWidth || defaultSecWidth)) : defaultSecWidth;
      const left = cursor - secWidth;
      panel.style.position = 'fixed';
      panel.style.left = Math.max(0, left) + 'px';
      panel.style.right = 'auto';
      panel.style.width = secWidth + 'px';
      panel.style.transform = 'none';
      // Only set height/bottom if panel doesn't have an explicit height yet
      if (!panel.dataset.hasCustomHeight) {
        panel.style.bottom = CHAT_BOTTOM_OFFSET + 'px';
        panel.style.height = mainRect.height + 'px';
        panel.style.top = mainRect.top + 'px';
      }
      cursor = left - GAP;
    });
  }

  /**
   * Reset all chat panels to equal size, tiled side by side, bottom-anchored.
   */
  function _resetChatLayout() {
    const mainPanel = document.getElementById('chat-panel');
    if (!mainPanel || !mainPanel.classList.contains('open')) return;

    const dockRight = typeof _getChatDockRightOffset === 'function' ? _getChatDockRightOffset() : 92;
    const GAP = CHAT_STACK_GAP;

    // Reset main panel to default docked position
    mainPanel.classList.remove('floating', 'snap-left', 'snap-right', 'dragging', 'move-active');
    mainPanel.style.left = '';
    mainPanel.style.top = '';
    mainPanel.style.right = dockRight + 'px';
    mainPanel.style.bottom = CHAT_BOTTOM_OFFSET + 'px';
    mainPanel.style.height = '500px';
    mainPanel.style.transform = '';

    // Count open panels (main + open secondaries)
    const openSecondaries = [];
    [1, 2, 3].forEach((slotNum) => {
      const p = secondaryChatPanels[String(slotNum)];
      if (p && p.classList.contains('open')) openSecondaries.push(p);
    });

    const totalPanels = 1 + openSecondaries.length;
    const available = window.innerWidth - dockRight;
    const totalGaps = (totalPanels - 1) * GAP;
    const equalWidth = Math.max(160, Math.floor((available - totalGaps) / totalPanels));

    // Set main panel width
    mainPanel.style.width = equalWidth + 'px';
    mainPanel.style.right = dockRight + 'px';

    // Reset secondaries — clear custom heights, equal size
    openSecondaries.forEach((panel) => {
      delete panel.dataset.hasCustomHeight;
      panel.style.height = '500px';
      panel.style.bottom = CHAT_BOTTOM_OFFSET + 'px';
      panel.style.top = '';
    });

    // Re-tile with new sizes
    _tileSecondaryPanelsNow();
    _positionExteriorTabs();

    // Scroll all to bottom
    chatWindows.forEach(w => w.scrollBottom());
  }

  function syncSecondaryChatControls() {
    secondarySlotButtons.forEach((button) => {
      const slotNum = button.dataset.chatSlotToggle;
      const panel = secondaryChatPanels[slotNum];
      const isOpen = !!panel && panel.classList.contains('open');
      button.classList.toggle('active', isOpen);
      button.classList.toggle('state-open', isOpen);
      button.classList.toggle('state-hidden', !isOpen);
      button.classList.remove('state-active');
      button.dataset.chatSlotState = isOpen ? 'open' : 'hidden';
      button.setAttribute('aria-pressed', isOpen ? 'true' : 'false');
      button.setAttribute('aria-label', `${isOpen ? 'Hide' : 'Open'} chat window ${slotNum}`);
      button.title = isOpen ? `Hide chat window ${slotNum}` : `Open chat window ${slotNum}`;
    });
    _tileSecondaryPanels();
  }

  function setActiveSecondarySlot(slotNum) {
    const slotKey = slotNum == null ? null : String(slotNum);
    if (slotKey && !secondaryChatPanels[slotKey]?.classList.contains('open')) return;
    activeSecondarySlot = slotKey;
    Object.entries(secondaryChatPanels).forEach(([otherSlot, panel]) => {
      panel?.classList.toggle('chat-panel-active', !!slotKey && otherSlot === slotKey && panel.classList.contains('open'));
    });
    syncSecondaryChatControls();
  }

  function inheritPrimarySelection(windowInstance) {
    if (!windowInstance || windowInstance.hasExplicitAgentSelection) return;
    const primaryOpt = primaryWindow.agentSelect?.selectedOptions?.[0];
    if (!primaryOpt) return;
    if (!primaryOpt.dataset.sessionKey) return;
    windowInstance.applySelection(primaryOpt, { markExplicit: false, preserveForInheritance: false, systemPrefix: 'Ready to chat with' });
  }

  function shouldUseSingleWindowMobileLayout() {
    return window.innerWidth <= 900;
  }

  function enforceSingleWindowMobileLayout() {
    if (!shouldUseSingleWindowMobileLayout()) return;
    // A desktop layout can be resized while several secondary windows are
    // open. Mobile intentionally exposes one full-width chat surface, so do
    // not leave desktop panels squeezed into unusable 1-2px strips.
    Object.keys(secondaryChatPanels).forEach((slotNum) => {
      if (secondaryChatPanels[slotNum]?.classList.contains('open')) {
        setSecondaryPanelOpen(slotNum, false);
      }
    });
    setActiveSecondarySlot(null);
  }

  function setSecondaryPanelOpen(slotNum, shouldOpen) {
    const slotKey = String(slotNum);
    const panel = secondaryChatPanels[slotKey];
    if (!panel) return;

    const isOpen = panel.classList.contains('open');
    if (isOpen === shouldOpen) {
      syncSecondaryChatControls();
      return;
    }

    if (shouldOpen && shouldUseSingleWindowMobileLayout()) {
      Object.entries(secondaryChatPanels).forEach(([otherSlot, otherPanel]) => {
        if (otherSlot === slotKey || !otherPanel.classList.contains('open')) return;
        setSecondaryPanelOpen(otherSlot, false);
      });
    }

    const windowInstance = chatWindowsByRoot.get(panel);
    if (shouldOpen) inheritPrimarySelection(windowInstance);

    panel.classList.toggle('open', shouldOpen);
    panel.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');

    if (shouldOpen) {
      panel.dataset.hiddenByUser = 'false';
      windowInstance?.scrollBottom();
      if (connected) {
        windowInstance?.loadHistory();
        windowInstance?.fetchSessionInfo();
      }
      windowInstance?.input?.focus();
    } else {
      panel.dataset.hiddenByUser = 'true';
      if (windowInstance?.streamingMsg) {
        windowInstance.finalizeStreamingMessage(windowInstance.streamingMsg.content || '');
        windowInstance.streamingMsg = null;
      }
      windowInstance?.removeTypingIndicator();
    }
    syncSecondaryChatControls();
  }

  function closeAllSecondaryPanels() {
    Object.keys(secondaryChatPanels).forEach((slotNum) => {
      _secExitMoveMode(slotNum);
      setSecondaryPanelOpen(slotNum, false);
    });
  }

  function toggleSecondaryPanel(slotNum) {
    if (!primaryWindow.root.classList.contains('open')) return;
    const slotKey = String(slotNum);
    const panel = secondaryChatPanels[slotKey];
    if (!panel) return;
    const isOpen = panel.classList.contains('open');
    setSecondaryPanelOpen(slotKey, !isOpen);
  }

  secondarySlotButtons.forEach((button) => button.addEventListener('click', () => toggleSecondaryPanel(button.dataset.chatSlotToggle)));

  // Reset layout button
  const chatResetBtn = document.getElementById('chat-reset-layout');
  if (chatResetBtn) chatResetBtn.addEventListener('click', () => _resetChatLayout());

  function nextId() { return `vw-${++reqId}-${Date.now()}`; }

  function browserGatewayUrlFromConfig(rawUrl) {
    if (!rawUrl) return '';
    try {
      const parsed = new URL(rawUrl);
      if (!['ws:', 'wss:'].includes(parsed.protocol)) return '';
      const browserHost = window.location.hostname || '127.0.0.1';
      if (LOCAL_GATEWAY_HOSTS.has(parsed.hostname)) {
        parsed.hostname = browserHost;
      }
      if (window.location.protocol === 'https:' && parsed.protocol === 'ws:') {
        parsed.protocol = 'wss:';
      }
      return parsed.toString();
    } catch (err) {
      console.warn('[chat] Invalid gateway URL:', rawUrl, err);
      return '';
    }
  }

  function getGatewayUrl() {
    const configured = browserGatewayUrlFromConfig(GATEWAY_URL);
    if (configured) return configured;
    const host = window.location.hostname || '127.0.0.1';
    if (window.location.protocol === 'https:') return `wss://${host}:8443/ws-gateway`;
    if (!_chatWsPort) return '';
    return `ws://${host}:${_chatWsPort}`;
  }

  function startModelBarRefresh() {
    if (_modelBarInterval) clearInterval(_modelBarInterval);
    _modelBarInterval = setInterval(() => {
      if (!connected) return;
      chatWindows.forEach(w => w.fetchSessionInfo());
    }, 60000);
  }

  async function connectGateway() {
    if (ws || gatewayEvents) return;
    chatWindows.forEach(w => w.setConnectionStatus('Connecting...', 'connecting'));
    await chatUiSettingsReady;
    await loadGatewayInfo();
    if (ws || gatewayEvents) return;
    if (GATEWAY_TRANSPORT === 'proxy') {
      connectGatewayProxy();
      return;
    }
    if (!GATEWAY_URL && !_chatWsPort) {
      chatWindows.forEach(w => w.setConnectionStatus('Gateway unavailable', 'disconnected'));
      return;
    }
    const gatewayUrl = getGatewayUrl();
    if (!gatewayUrl) {
      chatWindows.forEach(w => w.setConnectionStatus('Gateway unavailable', 'disconnected'));
      return;
    }
    try {
      ws = new WebSocket(gatewayUrl);
    } catch (err) {
      chatWindows.forEach(w => w.setConnectionStatus('Gateway unavailable', 'disconnected'));
      return;
    }
    const socket = ws;
    socket.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      if (msg.type === 'event' && msg.event === 'connect.challenge') return sendConnect(socket);
      if (msg.type === 'res') {
        const cb = pendingCallbacks[msg.id];
        if (cb) { delete pendingCallbacks[msg.id]; cb(msg); }
        return;
      }
      if (msg.type === 'event') handleEvent(msg);
    };
    socket.onclose = (evt) => {
      if (ws !== socket) return;
      connected = false;
      ws = null;
      const message = gatewayAuthFailed && gatewayAuthFailureMessage ? gatewayAuthFailureMessage : `Disconnected (${evt.code})`;
      chatWindows.forEach(w => w.setConnectionStatus(message, 'disconnected'));
      if (!gatewayAuthFailed && primaryWindow.root.classList.contains('open')) setTimeout(connectGateway, 3000);
    };
    socket.onerror = () => {
      if (ws === socket) chatWindows.forEach(w => w.setConnectionStatus('Connection error', 'disconnected'));
    };
  }

  function syncWindowAvailabilityStatus(chatWindow) {
    if (!connected || !chatWindow) return;
    const available = chatWindow.isSelectedAgentAvailable();
    chatWindow.setConnectionStatus(
      available ? 'Connected ⚡' : 'Offline — saved history only',
      available ? 'connected' : 'disconnected'
    );
  }

  function markGatewayConnected() {
    connected = true;
    gatewayAuthFailed = false;
    gatewayAuthFailureMessage = '';
    chatWindows.forEach(w => {
      syncWindowAvailabilityStatus(w);
      if (w.isPrimary || w.root.classList.contains('open')) {
        w.fetchSessionInfo();
        w.loadHistory();
      }
    });
    startModelBarRefresh();
  }

  function connectGatewayProxy() {
    if (gatewayEvents) return;
    let source;
    try {
      source = new EventSource(GATEWAY_EVENTS_URL, { withCredentials: true });
    } catch (_) {
      chatWindows.forEach(w => w.setConnectionStatus('Gateway proxy unavailable', 'disconnected'));
      return;
    }
    gatewayEvents = source;
    source.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      if (msg.type === 'proxy.ready') {
        markGatewayConnected();
        return;
      }
      if (msg.type === 'proxy.error') {
        connected = false;
        const message = msg.payload?.message || 'Gateway proxy unavailable';
        chatWindows.forEach(w => w.setConnectionStatus(message, 'disconnected'));
        source.close();
        if (gatewayEvents === source) gatewayEvents = null;
        if (primaryWindow.root.classList.contains('open')) setTimeout(connectGateway, 3000);
        return;
      }
      if (msg.type === 'event') handleEvent(msg);
    };
    source.onerror = () => {
      if (gatewayEvents !== source) return;
      connected = false;
      const terminal = source.readyState === EventSource.CLOSED;
      chatWindows.forEach(w => w.setConnectionStatus(terminal ? 'Gateway proxy unavailable' : 'Reconnecting...', terminal ? 'disconnected' : 'connecting'));
      if (terminal) {
        gatewayEvents = null;
        if (primaryWindow.root.classList.contains('open')) setTimeout(connectGateway, 3000);
      }
    };
  }

  function sendConnect(socket = ws) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const id = nextId();
    const msg = {
      type: 'req', id, method: 'connect',
      params: {
        minProtocol: 4, maxProtocol: 4,
        client: { id: 'openclaw-control-ui', version: GATEWAY_CLIENT_VERSION || 'unknown', platform: 'web', mode: 'webchat' },
        role: 'operator', scopes: ['operator.read', 'operator.write', 'operator.admin'], caps: ['tool-events'], commands: [], permissions: {},
        auth: { token: GATEWAY_TOKEN }, locale: 'en-US', userAgent: 'virtual-world-chat/1.0'
      }
    };
    pendingCallbacks[id] = (res) => {
      if (res.ok) {
        markGatewayConnected();
      } else {
        gatewayAuthFailed = true;
        gatewayAuthFailureMessage = `Auth failed: ${res.error?.message || 'unknown'}`;
        connected = false;
        chatWindows.forEach(w => w.setConnectionStatus(gatewayAuthFailureMessage, 'disconnected'));
        if (ws === socket) ws = null;
        try { socket.close(1008, 'auth failed'); } catch {}
      }
    };
    socket.send(JSON.stringify(msg));
  }

  async function rpc(method, params) {
    if (GATEWAY_TRANSPORT === 'proxy') {
      if (!connected) throw new Error('Not connected');
      const response = await fetch(GATEWAY_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ method, params })
      });
      const result = await response.json().catch(() => ({ ok:false, error:{ message:`Gateway proxy HTTP ${response.status}` } }));
      if (!response.ok && result.ok !== false) result.ok = false;
      return result;
    }
    return new Promise((resolve, reject) => {
      if (!ws || !connected) return reject(new Error('Not connected'));
      const id = nextId();
      pendingCallbacks[id] = resolve;
      ws.send(JSON.stringify({ type: 'req', id, method, params }));
      setTimeout(() => {
        if (pendingCallbacks[id]) { delete pendingCallbacks[id]; reject(new Error('Timeout')); }
      }, 30000);
    });
  }

  function handleEvent(msg) {
    const { event, payload } = msg;
    if (event === 'chat' || event === 'agent' || event === 'session.message') {
      chatWindows.forEach(w => w.queueOpenClawEvent(event, payload));
    }
  }

  function agentLabelFromId(agentId) {
    if (!agentId) return '';
    const opt = document.querySelector(`.chat-agent-select option[value="${CSS.escape(String(agentId))}"]`);
    return opt ? opt.textContent.trim() : String(agentId);
  }

  function getWindowAgentLabel(win) {
    return win?.agentSelect?.selectedOptions?.[0]?.textContent?.trim() || agentLabelFromId(win?.agentSelect?.value) || 'Assistant';
  }

  function parseAgentIdFromSessionKey(sessionKey) {
    const m = String(sessionKey || '').match(/^agent:([^:]+):/);
    return m ? m[1] : '';
  }

  function parseA2AEnvelope(text) {
    const m = String(text || '').match(/^\s*\[A2A\s+([^\]]+)\]\s*\n?/);
    if (!m) return null;
    const attrs = {};
    const raw = m[1];
    raw.replace(/([A-Za-z][\w-]*)=("[^"]*"|'[^']*'|\S+)/g, (_, k, v) => {
      v = String(v || '').trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      attrs[k] = v;
      return '';
    });
    const fromId = attrs.from || '';
    const toId = attrs.to || '';
    return {
      fromId,
      toId,
      label: attrs.name || agentLabelFromId(fromId) || fromId || 'Agent',
      toLabel: agentLabelFromId(toId) || toId || '',
      text: String(text || '').slice(m[0].length).trimStart()
    };
  }

  function normalizeSenderMeta(meta, role, win) {
    const out = { ...(meta || {}) };
    if (!out.label) {
      if (role === 'assistant') {
        out.label = getWindowAgentLabel(win);
        out.kind = out.kind || 'agent';
      } else if (role === 'user') {
        out.label = 'You';
        out.kind = out.kind || 'human';
      }
    }
    return out;
  }

  function isToolResultRole(role) {
    return ['tool', 'toolresult', 'tool_result', 'tool-result'].includes(String(role || '').toLowerCase());
  }

  function normalizeChatRole(role) {
    const normalized = String(role || '').toLowerCase();
    if (normalized === 'assistant' || isToolResultRole(normalized)) return 'assistant';
    if (normalized === 'system') return 'system';
    return 'user';
  }

  function resolveMessageSender(msg, win) {
    const message = msg?.message || msg || {};
    const role = message.role || msg?.role || '';
    const text = extractText(msg) || (typeof message.content === 'string' ? message.content : '') || '';
    const prov = message.provenance || msg?.provenance || {};
    const targetLabel = getWindowAgentLabel(win);

    if (role === 'assistant' || isToolResultRole(role)) return { label: targetLabel, kind: 'agent' };

    if (role === 'user' && prov?.kind === 'inter_session') {
      const sourceAgentId = parseAgentIdFromSessionKey(prov.sourceSessionKey || '');
      return {
        label: agentLabelFromId(sourceAgentId) || 'Agent',
        toLabel: targetLabel,
        kind: 'agent',
        isInterSession: true,
        sourceAgentId
      };
    }

    const envelope = parseA2AEnvelope(text);
    if (role === 'user' && envelope) {
      return { label: envelope.label, toLabel: envelope.toLabel || targetLabel, kind: 'agent', isInterSession: true, sourceAgentId: envelope.fromId };
    }

    return { label: 'You', kind: 'human' };
  }

  function renderSenderHeader(meta, role) {
    if (!meta?.label || role === 'system') return null;
    const div = document.createElement('div');
    div.className = 'chat-sender-label ' + (meta.kind === 'agent' ? 'agent' : 'human');
    div.textContent = meta.toLabel ? `${meta.label} → ${meta.toLabel}` : meta.label;
    return div;
  }

  function parseLivePlannerTurn(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    let candidate = raw;
    const fenced = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced) candidate = fenced[1].trim();
    if (!candidate.startsWith('{') || !candidate.endsWith('}')) return null;
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch (e) {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const keys = ['reflection', 'reflect', 'currentGoal', 'current_goal', 'goal', 'plan', 'steps', 'nextStep', 'next_step', 'memoryUpdate', 'memory_update', 'toolRequests', 'tool_requests', 'eventRequests', 'event_requests'];
    if (!keys.some(key => Object.prototype.hasOwnProperty.call(parsed, key))) return null;
    return { parsed, raw: candidate };
  }

  function plannerValueToText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      return JSON.stringify(value);
    } catch (e) {
      return String(value);
    }
  }

  function normalizePlannerList(value) {
    if (Array.isArray(value)) return value.map(plannerValueToText).filter(Boolean);
    const text = plannerValueToText(value);
    return text ? [text] : [];
  }

  function appendPlannerTextSection(root, title, value) {
    const text = plannerValueToText(value);
    if (!text) return false;
    const section = document.createElement('section');
    section.className = 'chat-live-plan-section';
    const heading = document.createElement('div');
    heading.className = 'chat-live-plan-heading';
    heading.textContent = title;
    const body = document.createElement('p');
    body.className = 'chat-live-plan-text';
    body.textContent = text;
    section.append(heading, body);
    root.appendChild(section);
    return true;
  }

  function appendPlannerListSection(root, title, values) {
    const items = normalizePlannerList(values);
    if (!items.length) return false;
    const section = document.createElement('section');
    section.className = 'chat-live-plan-section';
    const heading = document.createElement('div');
    heading.className = 'chat-live-plan-heading';
    heading.textContent = title;
    const list = document.createElement('ol');
    list.className = 'chat-live-plan-list';
    for (const itemText of items) {
      const item = document.createElement('li');
      item.textContent = itemText;
      list.appendChild(item);
    }
    section.append(heading, list);
    root.appendChild(section);
    return true;
  }

  function appendPlannerFieldRows(root, title, fields) {
    const rows = fields
      .map(([label, value]) => [label, plannerValueToText(value)])
      .filter(([, value]) => value);
    if (!rows.length) return false;
    const section = document.createElement('section');
    section.className = 'chat-live-plan-section';
    const heading = document.createElement('div');
    heading.className = 'chat-live-plan-heading';
    heading.textContent = title;
    const body = document.createElement('div');
    body.className = 'chat-live-plan-fields';
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.className = 'chat-live-plan-field';
      const labelEl = document.createElement('span');
      labelEl.className = 'chat-live-plan-field-label';
      labelEl.textContent = label;
      const valueEl = document.createElement('span');
      valueEl.className = 'chat-live-plan-field-value';
      valueEl.textContent = value;
      row.append(labelEl, valueEl);
      body.appendChild(row);
    }
    section.append(heading, body);
    root.appendChild(section);
    return true;
  }

  function appendPlannerNextStep(root, value) {
    if (!value) return false;
    if (typeof value !== 'object' || Array.isArray(value)) {
      return appendPlannerTextSection(root, 'Next Step', value);
    }
    return appendPlannerFieldRows(root, 'Next Step', [
      ['Intent', value.intent || value.reason],
      ['Action', value.action],
      ['Category', value.category],
      ['Target', value.target || value.targetId || value.targetName],
      ['Target Criteria', value.targetCriteria || value.target_criteria],
      ['Success Criteria', value.successCriteria || value.success_criteria]
    ]);
  }

  function appendPlannerRequests(root, title, value) {
    const rows = [];
    for (const item of Array.isArray(value) ? value : (value ? [value] : [])) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        const text = plannerValueToText(item);
        if (text) rows.push(['Request', text]);
        continue;
      }
      rows.push([
        item.type || item.name || item.category || 'Request',
        item.reason || item.intent || item.targetCriteria || item.description || item.prompt || item.query || item.action || item.id || item
      ]);
    }
    return appendPlannerFieldRows(root, title, rows);
  }

  function appendPlannerMemory(root, value) {
    if (!value) return false;
    if (typeof value !== 'object' || Array.isArray(value)) {
      return appendPlannerTextSection(root, 'Memory', value);
    }
    return appendPlannerFieldRows(root, 'Memory', [
      ['Lesson', value.lesson],
      ['Remember', value.remember],
      ['Status', value.status],
      ['Note', value.note || value.summary]
    ]);
  }

  function renderLivePlannerTurn(text) {
    const result = parseLivePlannerTurn(text);
    if (!result) return null;
    const turn = result.parsed;
    const wrap = document.createElement('div');
    wrap.className = 'chat-live-plan';
    let rendered = 0;
    rendered += appendPlannerTextSection(wrap, 'Reflection', turn.reflection || turn.reflect) ? 1 : 0;
    rendered += appendPlannerTextSection(wrap, 'Current Goal', turn.currentGoal || turn.current_goal || turn.goal) ? 1 : 0;
    rendered += appendPlannerListSection(wrap, 'Plan', turn.plan || turn.steps) ? 1 : 0;
    rendered += appendPlannerNextStep(wrap, turn.nextStep || turn.next_step) ? 1 : 0;
    rendered += appendPlannerRequests(wrap, 'Tool Requests', turn.toolRequests || turn.tool_requests) ? 1 : 0;
    rendered += appendPlannerRequests(wrap, 'Event Requests', turn.eventRequests || turn.event_requests) ? 1 : 0;
    rendered += appendPlannerMemory(wrap, turn.memoryUpdate || turn.memory_update) ? 1 : 0;
    if (!rendered) return null;

    const details = document.createElement('details');
    details.className = 'chat-live-plan-raw';
    const summary = document.createElement('summary');
    summary.textContent = 'Raw planner JSON';
    const pre = document.createElement('pre');
    pre.textContent = result.raw.length > 5000 ? result.raw.slice(0, 5000) + '\n... [truncated]' : result.raw;
    details.append(summary, pre);
    wrap.appendChild(details);
    return wrap;
  }

  function extractToolItems(msg) {
    const c = msg?.message?.content ?? msg?.content;
    if (!Array.isArray(c)) return [];
    const tools = [];
    for (const b of c) {
      if (!b || typeof b !== 'object') continue;
      const type = b.type || '';
      if (type === 'toolCall' || type === 'tool_call') {
        tools.push({
          status: 'done',
          name: b.name || b.toolName || b.function?.name || 'tool',
          arguments: b.arguments || b.args || b.input || b.function?.arguments || {},
          id: b.id || b.toolCallId || b.callId || ''
        });
      } else if (type === 'toolResult' || type === 'tool_result') {
        const last = tools[tools.length - 1];
        const result = b.result ?? b.output ?? b.content ?? b.text ?? b.error ?? '';
        const isError = isHistoricalToolError(b, msg);
        if (last && (!b.toolCallId || b.toolCallId === last.id)) {
          last.result = result;
          last.status = isError ? 'error' : 'done';
          if (isError) last.error = typeof result === 'string' ? result : JSON.stringify(result);
        } else {
          tools.push({
            status: isError ? 'error' : 'done',
            name: b.name || 'tool result',
            result: isError ? '' : result,
            error: isError ? result : '',
            id: b.toolCallId || b.id || ''
          });
        }
      }
    }
    return tools;
  }

  function normalizeToolStatus(value, error = '', result = '') {
    if (error) return 'error';
    const status = String(value || '').toLowerCase();
    if (['error', 'failed', 'failure', 'cancelled', 'canceled'].includes(status)) return 'error';
    if (['done', 'completed', 'complete', 'success', 'succeeded', 'result', 'end'].includes(status)) return 'done';
    if (!status && result) return 'done';
    return 'running';
  }

  function normalizeHistoricalTools(items) {
    if (!Array.isArray(items)) return [];
    return items.filter(Boolean).map((item) => {
      const rawStatus = String(item.status || (item.error ? 'error' : item.result ? 'done' : 'running')).toLowerCase();
      const status = normalizeToolStatus(rawStatus, item.error, item.result ?? item.output);
      return {
        id: item.id || item.toolCallId || item.callId || '',
        runId: item.runId || '',
        status,
        name: item.name || item.toolName || item.tool_name || 'tool',
        arguments: coerceToolArgs(item.arguments || item.args || item.input || {}),
        result: item.result ?? item.output ?? item.content ?? (['cancelled', 'canceled'].includes(rawStatus) ? 'Cancelled' : ''),
        error: item.error || ''
      };
    });
  }

  function normalizeHermesTools(items, coerceCompleted = false) {
    if (!Array.isArray(items)) return [];
    return items.filter(Boolean).map((item) => {
      const rawStatus = String(item.status || (item.error ? 'error' : 'done')).toLowerCase();
      let status = normalizeToolStatus(rawStatus, item.error, item.result ?? item.output ?? item.content);
      let result = item.result ?? item.output ?? item.content ?? '';
      if (!result && ['cancelled', 'canceled'].includes(rawStatus)) result = 'Cancelled';
      if (coerceCompleted && status === 'running') {
        status = 'done';
        if (!result || result === 'Running') result = 'Completed';
      }
      return {
        id: item.id || item.toolCallId || item.callId || '',
        runId: item.runId || '',
        status,
        name: item.name || item.toolName || item.tool_name || 'tool',
        arguments: coerceToolArgs(item.arguments || item.args || item.input || (item.args_preview ? { command: item.args_preview } : {})),
        result,
        error: item.error || ''
      };
    });
  }

  function normalizeToolEvent(payload, fallbackStatus = 'running') {
    const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
    const phase = data.phase || payload?.phase || '';
    const isError = data.isError || payload?.isError || payload?.error;
    let status = payload?.status || fallbackStatus;
    if (phase === 'start' || phase === 'update') status = 'running';
    if (phase === 'result' || phase === 'end') status = isError ? 'error' : 'done';
    const result = data.result ?? data.partialResult ?? payload?.result ?? payload?.output ?? payload?.content ?? payload?.text ?? '';
    const error = data.error || payload?.error || (isError && typeof result === 'string' ? result : '');
    let args = data.args || data.arguments || payload?.arguments || payload?.args || payload?.input || {};
    if (!args || typeof args !== 'object' || Array.isArray(args)) args = { value: args };
    if (data.meta && !args.command && !args.description) args.description = data.meta;
    return {
      id: data.toolCallId || data.itemId || payload?.toolCallId || payload?.callId || payload?.itemId || payload?.id || '',
      runId: payload?.runId || data.runId || '',
      status,
      name: data.name || data.title || payload?.name || payload?.tool || payload?.toolName || 'tool',
      arguments: args,
      result,
      error
    };
  }

  function renderToolCallCard(tool, opts = {}) {
    const details = document.createElement('details');
    details.className = `chat-tool-call ${tool.status || 'running'}`;
    details.open = toolCallsExpandedByDefault;
    details.dataset.toolName = tool.name || 'tool';

    const summary = document.createElement('summary');
    summary.className = 'chat-tool-summary';
    const dot = document.createElement('span');
    dot.className = 'chat-tool-running-dot';
    const icon = document.createElement('span');
    icon.className = 'chat-tool-icon';
    icon.textContent = toolIcon(tool);
    const name = document.createElement('span');
    name.className = 'chat-tool-name';
    name.textContent = formatToolName(tool.name);
    const preview = document.createElement('span');
    preview.className = 'chat-tool-preview';
    preview.textContent = formatToolPreview(tool);
    const toggle = document.createElement('span');
    toggle.className = 'chat-tool-toggle';
    toggle.textContent = '▶';
    const state = document.createElement('span');
    state.className = 'chat-tool-state';
    state.textContent = tool.status === 'error' ? 'error' : tool.status === 'done' ? 'done' : 'running';
    summary.append(dot, icon, name, preview, toggle, state);
    details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'chat-tool-body';
    body.appendChild(renderToolSection('Input', formatToolPayload(tool.arguments || {})));
    if (tool.result || tool.error) body.appendChild(renderToolSection(tool.error ? 'Error' : 'Result', formatToolPayload(tool.error || tool.result)));
    details.appendChild(body);
    return details;
  }

  function updateToolCallCard(card, tool) {
    if (!card) return;
    const previousStatus = card.classList.contains('running') ? 'running' : card.classList.contains('error') ? 'error' : card.classList.contains('done') ? 'done' : '';
    card.classList.remove('running', 'done', 'error');
    card.classList.add(tool.status || 'done');
    if (previousStatus && previousStatus !== (tool.status || 'done')) {
      card.classList.add('status-changed');
      setTimeout(() => card.classList.remove('status-changed'), 850);
      if ((tool.status === 'done' || tool.status === 'error') && card.open) {
        setTimeout(() => { if (card.classList.contains('done') || card.classList.contains('error')) card.open = false; }, 900);
      }
    }
    const icon = card.querySelector('.chat-tool-icon');
    if (icon) icon.textContent = toolIcon(tool);
    const state = card.querySelector('.chat-tool-state');
    if (state) state.textContent = tool.status === 'error' ? 'error' : tool.status === 'done' ? 'done' : 'running';
    const name = card.querySelector('.chat-tool-name');
    if (name) name.textContent = formatToolName(tool.name);
    const preview = card.querySelector('.chat-tool-preview');
    if (preview) preview.textContent = formatToolPreview(tool);
    const body = card.querySelector('.chat-tool-body');
    if (body) {
      body.innerHTML = '';
      body.appendChild(renderToolSection('Input', formatToolPayload(tool.arguments || {})));
      if (tool.result || tool.error) body.appendChild(renderToolSection(tool.error ? 'Error' : tool.status === 'running' ? 'Progress' : 'Result', formatToolPayload(tool.error || tool.result)));
    }
  }

  function renderToolSection(label, text) {
    const section = document.createElement('div');
    section.className = 'chat-tool-section';
    const h = document.createElement('div');
    h.className = 'chat-tool-section-label';
    h.textContent = label;
    const pre = document.createElement('pre');
    pre.textContent = text || '—';
    section.append(h, pre);
    return section;
  }

  function renderThinkingCard(text) {
    const details = document.createElement('details');
    details.className = 'chat-thinking-card';
    const summary = document.createElement('summary');
    summary.className = 'chat-thinking-summary';
    const icon = document.createElement('span');
    icon.textContent = '💡';
    const title = document.createElement('span');
    title.className = 'chat-thinking-title';
    title.textContent = 'Thinking';
    const state = document.createElement('span');
    state.className = 'chat-tool-state';
    state.textContent = 'trace';
    summary.append(icon, title, state);
    const body = document.createElement('div');
    body.className = 'chat-thinking-body';
    const pre = document.createElement('pre');
    pre.textContent = String(text || '').trim();
    body.appendChild(pre);
    details.append(summary, body);
    return details;
  }

  function renderHermesApprovalCard(approval, windowInstance) {
    const card = document.createElement('div');
    const status = String(approval.status || 'pending').toLowerCase();
    const visualStatus = status.includes('approved')
      ? 'approved'
      : (status.includes('denied') || status.includes('expired') || status.includes('timeout'))
        ? 'denied'
        : 'pending';
    card.className = 'chat-approval-card ' + visualStatus;
    card.dataset.approvalId = approval.approval_id || approval.id || '';

    const header = document.createElement('div');
    header.className = 'chat-approval-header';
    const icon = document.createElement('span');
    icon.className = 'chat-approval-icon';
    icon.textContent = visualStatus === 'denied' ? 'x' : visualStatus === 'approved' ? 'OK' : '!';
    const title = document.createElement('span');
    title.className = 'chat-approval-title';
    const providerKind = String(approval.providerKind || approval.provider || '').toLowerCase();
    const isHermesApproval = providerKind.includes('hermes') || windowInstance?.isHermesSelected();
    const providerLabel = windowInstance?.agentSelect?.selectedOptions?.[0]?.textContent?.trim() || 'Provider';
    title.textContent = approval.title || `${providerLabel} approval required`;
    const state = document.createElement('span');
    state.className = 'chat-approval-status';
    const pendingCount = Number(approval.pending_count || approval.pendingCount || 0);
    state.textContent = status === 'pending' && pendingCount > 1 ? `${pendingCount} pending` : (status === 'pending' ? 'pending' : status);
    header.append(icon, title, state);

    const desc = document.createElement('div');
    desc.className = 'chat-approval-desc';
    desc.textContent = approval.description || `${providerLabel} needs user approval before it can continue.`;

    const cmd = document.createElement('pre');
    cmd.className = 'chat-approval-command';
    cmd.textContent = approval.command || 'Approval-gated provider action';

    card.append(header, desc, cmd);
    if (status === 'pending') {
      const actions = document.createElement('div');
      actions.className = 'chat-approval-actions';
      const allow = document.createElement('button');
      allow.type = 'button';
      allow.className = 'chat-approval-btn primary';
      allow.textContent = 'Allow once';
      allow.title = 'Retry this Hermes turn with approval bypass for this invocation only';
      allow.addEventListener('click', () => {
        if (isHermesApproval) windowInstance?.respondHermesApproval(approval, 'approve_once', card);
        else windowInstance?.respondProviderApproval(approval, 'approve', card);
      });
      const deny = document.createElement('button');
      deny.type = 'button';
      deny.className = 'chat-approval-btn';
      deny.textContent = 'Deny';
      deny.title = 'Do not retry this blocked Hermes command';
      deny.addEventListener('click', () => {
        if (isHermesApproval) windowInstance?.respondHermesApproval(approval, 'deny', card);
        else windowInstance?.respondProviderApproval(approval, 'cancel', card);
      });
      actions.append(allow, deny);
      card.appendChild(actions);
    }
    return card;
  }

  function coerceToolArgs(value) {
    if (!value) return {};
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch { return { input: value }; }
    }
    return typeof value === 'object' ? value : { value };
  }

  function formatToolPayload(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'string') return value.length > 6000 ? value.slice(0, 6000) + '\n… [truncated]' : value;
    try {
      const s = JSON.stringify(value, null, 2);
      return s.length > 6000 ? s.slice(0, 6000) + '\n… [truncated]' : s;
    } catch {
      return String(value);
    }
  }

  function extractText(msg) {
    const c = msg?.message?.content ?? msg?.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.filter(b => b.type === 'text').map(b => b.text).join('');
    return '';
  }

  function stringifyGatewayError(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'object') {
      for (const key of ['message', 'errorMessage', 'error', 'detail', 'details', 'reason', 'description', 'providerErrorMessagePreview']) {
        const nested = stringifyGatewayError(value[key]);
        if (nested) return nested;
      }
      try {
        const json = JSON.stringify(value);
        return json === '{}' ? '' : json;
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  function extractRunError(payload, fallback = 'The run failed before returning a reply.') {
    const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
    const nestedPayload = payload?.payload && typeof payload.payload === 'object' ? payload.payload : {};
    const candidates = [
      payload?.errorMessage,
      payload?.error,
      typeof payload?.message === 'string' ? payload.message : '',
      data.errorMessage,
      data.error,
      data.message,
      data.providerErrorMessagePreview,
      nestedPayload.errorMessage,
      nestedPayload.error,
      nestedPayload.message,
      extractText(payload),
      extractText(nestedPayload)
    ];
    let message = '';
    for (const candidate of candidates) {
      message = stringifyGatewayError(candidate);
      if (message) break;
    }
    message = message.replace(/^Error:\s*/i, '').trim();
    return message || fallback;
  }

  function extractMedia(msg, text) {
    const media = [];
    const c = msg?.message?.content ?? msg?.content;
    const add = (item) => {
      const normalized = normalizeOneChatMedia(item);
      if (normalized) media.push(normalized);
    };
    if (Array.isArray(c)) {
      for (const b of c) {
        if (!b || b.type === 'text') continue;
        if (b.type === 'image' || b.type === 'image_url' || b.type === 'input_image') {
          add({ url: b.url || b.image_url?.url || b.source?.url || b.path || b.filePath, mimeType: b.mimeType || b.media_type || b.source?.media_type || 'image/*', name: b.name || b.filename || 'image' });
        } else if (b.type === 'file' || b.type === 'media' || b.type === 'attachment' || b.type === 'video' || b.type === 'audio') {
          add({ url: b.url || b.path || b.filePath || b.source?.url, mimeType: b.mimeType || b.media_type || b.contentType || b.source?.media_type || '', name: b.name || b.filename });
        }
      }
    }
    const sourceText = text || '';
    for (const rawLine of sourceText.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (/^MEDIA:/i.test(line)) add({ url: line.replace(/^MEDIA:/i, '').trim() });
      const attachMatch = line.match(/^\(attached file:\s*(.+?)\)$/i) || line.match(/^attached file:\s*(.+)$/i);
      if (attachMatch) add({ url: attachMatch[1].trim() });
    }
    const seen = new Set();
    return media.filter(item => {
      const key = item.url || item.path;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function normalizeOneChatMedia(item) {
    if (!item) return null;
    if (typeof item === 'string') item = { url: item };
    let url = item.url || item.path || item.filePath || item.href || item.mediaUrl || item.proxyUrl || '';
    if (!url) return null;
    url = String(url).trim();
    const dataUrlMatch = url.match(/^data:([^;,]+)[;,]/i);
    const dataMime = dataUrlMatch ? dataUrlMatch[1].toLowerCase() : '';
    const name = item.name || item.filename || (dataMime ? (dataMime.split('/')[0] || 'media') : decodeURIComponent((url.split('/').pop() || 'media').split('?')[0]));
    const mimeType = item.mimeType || item.contentType || (dataMime && dataMime !== 'text/plain' ? dataMime : '') || item.type || guessMimeFromName(name, url);
    const isLocalPath = url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/__openclaw__') && !url.startsWith('/sms-media') && !url.startsWith('/chat-media');
    const src = isLocalPath ? '/chat-media?path=' + encodeURIComponent(url) : url;
    return { url: src, originalUrl: url, name, mimeType };
  }

  function normalizeChatMedia(items) {
    if (!items) return [];
    if (!Array.isArray(items)) items = [items];
    return items.map(normalizeOneChatMedia).filter(Boolean);
  }

  function guessMimeFromName(name, url) {
    const v = (name || url || '').toLowerCase().split('?')[0];
    if (/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/.test(v)) return 'image/*';
    if (/\.(mp4|webm|mov|m4v|ogg)$/.test(v)) return 'video/*';
    if (/\.(mp3|wav|m4a|aac|flac|opus)$/.test(v)) return 'audio/*';
    if (/\.pdf$/.test(v)) return 'application/pdf';
    return '';
  }

  function renderChatMedia(media) {
    const wrap = document.createElement('div');
    wrap.className = 'chat-media-list';
    for (const item of media) {
      const type = (item.mimeType || '').toLowerCase();
      const card = document.createElement('figure');
      card.className = 'chat-media-item';
      if (type.startsWith('image/') || type === 'image/*') {
        const img = document.createElement('img');
        img.src = item.url;
        img.alt = item.name || 'image';
        img.className = 'chat-image-thumb chat-image-clickable';
        img.addEventListener('click', () => openImageLightbox(item.url));
        card.appendChild(img);
      } else if (type.startsWith('video/') || type === 'video/*') {
        const video = document.createElement('video');
        video.src = item.url;
        video.controls = true;
        video.preload = 'metadata';
        video.className = 'chat-media-video';
        card.appendChild(video);
      } else if (type.startsWith('audio/') || type === 'audio/*') {
        const audio = document.createElement('audio');
        audio.src = item.url;
        audio.controls = true;
        audio.preload = 'metadata';
        audio.className = 'chat-media-audio';
        card.appendChild(audio);
      } else {
        const link = document.createElement('a');
        link.href = item.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.className = 'chat-media-file';
        link.textContent = '📎 ' + (item.name || 'Open attachment');
        card.appendChild(link);
      }
      if (item.name && (type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/') || type.endsWith('/*'))) {
        const cap = document.createElement('figcaption');
        cap.textContent = item.name;
        card.appendChild(cap);
      }
      wrap.appendChild(card);
    }
    return wrap;
  }

  function parseDataUrl(dataUrl) {
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    return { mimeType: m[1], content: m[2] };
  }

  function compressImage(dataUrl, maxBase64Len = 350000) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        const maxDim = 800;
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * ratio); h = Math.round(h * ratio);
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        let quality = 0.7;
        let result = canvas.toDataURL('image/jpeg', quality);
        while (result.length - 23 > maxBase64Len && quality > 0.05) {
          quality -= 0.1;
          if (quality < 0.3 && w > 400) {
            w = Math.round(w * 0.7); h = Math.round(h * 0.7);
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          }
          result = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(result);
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  function openImageLightbox(src) {
    let overlay = document.getElementById('image-lightbox');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'image-lightbox';
      overlay.className = 'image-lightbox';
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.classList.contains('lightbox-close')) overlay.classList.remove('active');
      });
      const closeBtn = document.createElement('button');
      closeBtn.className = 'lightbox-close';
      closeBtn.textContent = '✕';
      overlay.appendChild(closeBtn);
      const img = document.createElement('img');
      img.className = 'lightbox-img';
      overlay.appendChild(img);
      document.body.appendChild(overlay);
    }
    overlay.querySelector('.lightbox-img').src = src;
    overlay.classList.add('active');
  }

  function formatToolLabel(name, args) {
    const truncate = (s, n) => s && s.length > n ? s.slice(0, n) + '...' : (s || '');
    switch (name) {
      case 'exec': return '⚙️ exec: ' + truncate(args.command || '', 60);
      case 'bash': return '⚙️ bash: ' + truncate(args.command || args.description || '', 60);
      case 'Command': return '⚙️ command: ' + truncate(args.command || args.description || '', 60);
      case 'read': return '📄 read: ' + truncate(args.path || args.file_path || '', 50);
      case 'write': return '💾 write: ' + truncate(args.path || args.file_path || '', 50);
      case 'edit': return '✏️ edit: ' + truncate(args.path || args.file_path || '', 50);
      case 'sessions_send': return '📡 sessions_send → ' + truncate(args.sessionKey || args.label || '', 40);
      case 'sessions_spawn': return '🤖 spawn: ' + truncate(args.agentId || '', 30) + (args.task ? ' — ' + truncate(args.task, 40) : '');
      case 'sessions_history': return '📜 history: ' + truncate(args.sessionKey || '', 40);
      case 'sessions_list': return '📋 sessions_list';
      case 'todo': return '✅ tasks: ' + truncate(args.todos ? `${args.todos.length} updates` : args.content || args.id || '', 50);
      case 'memory_search': return '🧠 memory: ' + truncate(args.query || '', 50);
      case 'memory_get': return '🧠 memory_get: ' + truncate(args.path || '', 40);
      case 'web_search': return '🔍 search: ' + truncate(args.query || '', 50);
      case 'web_fetch': return '🌐 fetch: ' + truncate(args.url || '', 50);
      case 'browser': return '🖥️ browser: ' + truncate(args.action || '', 20);
      case 'process': return '🔄 process: ' + truncate(args.action || '', 20);
      case 'tts': return '🔊 tts';
      case 'image': return '🖼️ image analysis';
      default: return '🔧 ' + (name || 'tool');
    }
  }

  function formatToolName(name) {
    const raw = String(name || 'tool');
    if (raw === 'Command') return 'command';
    if (raw === 'Hermes task breakdown') return 'task plan';
    return raw.replace(/^functions\./, '');
  }

  function toolIcon(tool) {
    const name = String(tool?.name || '').toLowerCase();
    if (tool?.status === 'error' || tool?.error) return '⚠️';
    if (name.includes('task') || name === 'todo') return tool?.status === 'done' ? '✓' : '◌';
    if (name.includes('read') || name.includes('fetch')) return '📄';
    if (name.includes('write') || name.includes('edit')) return '✎';
    if (name.includes('search')) return '⌕';
    if (name.includes('browser')) return '◈';
    if (tool?.status === 'done') return '✓';
    return '⚡';
  }

  function formatToolPreview(tool) {
    const args = coerceToolArgs(tool?.arguments || {});
    const result = String(tool?.error || tool?.result || '').replace(/\s+/g, ' ').trim();
    const pick = (...keys) => {
      for (const key of keys) if (args[key]) return String(args[key]);
      return '';
    };
    let preview = '';
    switch (tool?.name) {
      case 'exec':
      case 'bash':
      case 'Command':
        preview = pick('command', 'description', 'value');
        break;
      case 'read':
      case 'write':
      case 'edit':
        preview = pick('path', 'file_path', 'filePath');
        break;
      case 'sessions_send':
        preview = pick('sessionKey', 'label', 'message');
        break;
      case 'sessions_spawn':
        preview = [pick('agentId'), pick('task')].filter(Boolean).join(' · ');
        break;
      case 'todo':
        preview = args.todos ? `${args.todos.length} task updates` : pick('content', 'id');
        break;
      case 'Hermes task breakdown':
        preview = args.now || (Array.isArray(args.done) ? `${args.done.length} steps complete` : 'receive · run · export · render');
        break;
      default:
        preview = pick('query', 'url', 'action', 'input', 'value');
    }
    if (!preview && result) preview = result;
    if (!preview) preview = tool?.status === 'running' ? 'running...' : 'completed';
    return preview.length > 90 ? preview.slice(0, 87) + '...' : preview;
  }

  updateChatStackLayout();
  const primaryWindow = new ChatWindow(document.getElementById('chat-panel'), { isPrimary: true });
  const chatWindows = [primaryWindow];
  const chatWindowsByRoot = new Map([[primaryWindow.root, primaryWindow]]);
  secondaryChatPanels = Object.fromEntries(Object.keys(secondaryPanelPlaceholders).map((slot) => [slot, buildSecondaryChatPanel(Number(slot))]));
  Object.entries(secondaryChatPanels).forEach(([slot, panel]) => {
    const w = new ChatWindow(panel, { slot: Number(slot) });
    chatWindows.push(w);
    chatWindowsByRoot.set(panel, w);
  });

  const agentListsReady = Promise.all(chatWindows.map(w => w.loadAgentList()));
  window.addEventListener('vw:agents-changed', () => {
    chatWindows.forEach(w => w.loadAgentList().catch(() => {}));
  });
  window.addEventListener('vw:agent-model-changed', () => {
    chatWindows.forEach(w => w.fetchSessionInfo().catch(() => {}));
  });
  syncSecondaryChatControls();
  // Virtual World shows the chat dock in the HUD even before the panel is expanded.
  // Connect immediately so users don't see a stale "Offline" state while the UI is visible.
  Promise.all([gatewayInfoReady, chatUiSettingsReady]).then(() => connectGateway()).catch(() => {});

  function applyQueryAgentAssignments() {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('chatAgents');
    if (!mode) return;
    const windows = [primaryWindow, ...Object.values(secondaryChatPanels).map(panel => chatWindowsByRoot.get(panel)).filter(Boolean)];
    const allOptions = primaryWindow.agentSelect ? Array.from(primaryWindow.agentSelect.querySelectorAll('option')) : [];
    if (!allOptions.length) return;

    let assignments = [];
    if (mode === 'auto') {
      assignments = allOptions.slice(0, windows.length);
    } else {
      const requestedKeys = mode.split(',').map(s => s.trim()).filter(Boolean);
      assignments = requestedKeys.map((key) => allOptions.find(opt => opt.value === key || opt.dataset.agentId === key || opt.dataset.sessionKey === key)).filter(Boolean);
    }

    assignments.forEach((opt, index) => {
      const windowInstance = windows[index];
      if (!windowInstance || !opt) return;
      windowInstance.applySelection(opt, { markExplicit: false, preserveForInheritance: true, systemPrefix: 'Loaded' });
    });
  }

  const chatBtn = document.getElementById('chat-toggle');
  const exteriorTabs = document.getElementById('chat-exterior-tabs');
  if (exteriorTabs && exteriorTabs.parentElement !== primaryWindow.root) {
    // Keep the tab strip structurally attached to the primary chat panel so it
    // moves/resizes as one object instead of lagging as a separate fixed layer.
    primaryWindow.root.appendChild(exteriorTabs);
  }

  /* Position the exterior tabs bar right above the chat panel.
     Keep it synced continuously while open so the W1/W2/W3 buttons feel
     physically attached during open/close, resize, move, and sidebar shifts. */
  let _tabsRafPending = false;
  let _tabsFollowActive = false;
  function _positionExteriorTabs() {
    if (_tabsRafPending) return;
    _tabsRafPending = true;
    requestAnimationFrame(() => {
      _tabsRafPending = false;
      if (!exteriorTabs) return;
      const panel = primaryWindow.root;
      const shouldFollow = panel.classList.contains('open') && exteriorTabs.classList.contains('visible');
      if (!shouldFollow) return;
      if (exteriorTabs.parentElement === panel) {
        exteriorTabs.style.bottom = '';
        exteriorTabs.style.right = '';
        exteriorTabs.style.width = '';
        if (_tabsFollowActive) _positionExteriorTabs();
        return;
      }
      const rect = panel.getBoundingClientRect();
      const inset = Math.min(18, Math.max(8, rect.width * 0.035));
      const targetWidth = Math.max(132, rect.width - inset * 2);
      const minRight = 6;
      const maxRight = Math.max(minRight, window.innerWidth - targetWidth - 6);
      const targetRight = Math.max(minRight, Math.min(maxRight, window.innerWidth - rect.right + inset));
      exteriorTabs.style.bottom = Math.max(0, window.innerHeight - rect.top - 1) + 'px';
      exteriorTabs.style.right = targetRight + 'px';
      exteriorTabs.style.width = targetWidth + 'px';
      if (_tabsFollowActive) _positionExteriorTabs();
    });
  }
  function _startExteriorTabsFollow() {
    _tabsFollowActive = true;
    _positionExteriorTabs();
  }
  function _stopExteriorTabsFollow() {
    _tabsFollowActive = false;
  }

  function setPrimaryPanelOpen(shouldOpen) {
    primaryWindow.root.classList.toggle('open', shouldOpen);
    chatBtn.classList.toggle('active', shouldOpen);
    chatBtn.style.display = shouldOpen ? 'none' : 'flex';
    if (exteriorTabs) exteriorTabs.classList.toggle('visible', shouldOpen);
    if (shouldOpen) {
      _startExteriorTabsFollow();
      setTimeout(_positionExteriorTabs, 360);
    } else {
      _stopExteriorTabsFollow();
    }
    if (shouldOpen && !ws && !gatewayEvents) connectGateway();
    if (shouldOpen) {
      primaryWindow.input.focus();
      primaryWindow.scrollBottom();
      if (connected) { primaryWindow.loadHistory(); primaryWindow.fetchSessionInfo(); }
    } else {
      closeAllSecondaryPanels();
    }
  }

  async function refreshGatewayConnectionFromSettings() {
    gatewayAuthFailed = false;
    gatewayAuthFailureMessage = '';
    pendingCallbacks = {};
    const oldWs = ws;
    const oldEvents = gatewayEvents;
    ws = null;
    gatewayEvents = null;
    connected = false;
    if (oldWs) {
      try { oldWs.close(1000, 'settings updated'); } catch {}
    }
    if (oldEvents) {
      try { oldEvents.close(); } catch {}
    }
    await loadGatewayInfo();
    connectGateway();
  }

  function forcePrimaryPanelToggle(e) {
    // Capture-phase guard: keeps the chat button reliable even if another
    // listener/regression interrupts the normal toggle path.
    e?.preventDefault?.();
    e?.stopImmediatePropagation?.();
    const shouldOpen = !primaryWindow.root.classList.contains('open');
    setPrimaryPanelOpen(shouldOpen);
  }

  chatBtn.addEventListener('click', forcePrimaryPanelToggle, true);

  chatBtn.addEventListener('click', () => {
    setPrimaryPanelOpen(!primaryWindow.root.classList.contains('open'));
  });

  window.addEventListener('vw:settings-saved', (event) => {
    applyChatUiSettings(event.detail?.config || window.__VWConfig || {}, { applyExisting: true });
    refreshGatewayConnectionFromSettings().catch(() => {});
  });

  const chatUrlParams = new URLSearchParams(window.location.search);
  const chatViewParam = chatUrlParams.get('chatView');
  if (chatViewParam === 'all') {
    setTimeout(() => {
      setPrimaryPanelOpen(true);
      setSecondaryPanelOpen('1', true);
      setSecondaryPanelOpen('2', true);
      setSecondaryPanelOpen('3', true);
      enforceSingleWindowMobileLayout();
      agentListsReady.then(applyQueryAgentAssignments).catch(() => {});
    }, 50);
  } else if (chatUrlParams.get('chatAgents')) {
    agentListsReady.then(applyQueryAgentAssignments).catch(() => {});
  }

  // Gateway info is refreshed on connect and after settings saves so token changes
  // apply without a full browser reload.

  // --- DIRECT HEADER DRAG / SNAP SYSTEM (primary window only) ---
  const chatPanel = primaryWindow.root;
  let _chatDragging = false;
  let _chatDragCandidate = false;
  let _chatDragPointerId = null;
  let _chatDragStartX = 0, _chatDragStartY = 0;
  let _chatOrigLeft = 0, _chatOrigTop = 0;
  let _chatSnapZoneL = null, _chatSnapZoneR = null;
  const CHAT_DRAG_THRESHOLD = 5;

  function _chatCreateSnapZones() {
    if (_chatSnapZoneL) return;
    _chatSnapZoneL = document.createElement('div'); _chatSnapZoneL.className = 'chat-snap-zone left';
    _chatSnapZoneR = document.createElement('div'); _chatSnapZoneR.className = 'chat-snap-zone right';
    document.body.appendChild(_chatSnapZoneL); document.body.appendChild(_chatSnapZoneR);
  }
  function _chatRemoveSnapZones() {
    if (_chatSnapZoneL) { _chatSnapZoneL.remove(); _chatSnapZoneL = null; }
    if (_chatSnapZoneR) { _chatSnapZoneR.remove(); _chatSnapZoneR = null; }
  }
  function _getSidebarWidth() {
    var sb = document.getElementById('sidebar') || document.querySelector('.sidebar');
    var edge = document.querySelector('.sidebar-edge');
    if (!sb) return edge ? edge.offsetWidth : 0;
    if (sb.classList.contains('sidebar-collapsed') || sb.classList.contains('collapsed')) return edge ? edge.offsetWidth : 0;
    return sb.offsetWidth + (edge ? edge.offsetWidth : 0);
  }
  function _getChatDockRightOffset() {
    // Dock the chat to the left of Virtual World's zoom/rotate controls instead
    // of covering them. This stays dynamic/product-safe: no personal paths,
    // keys, or tokens are hardcoded here.
    var zoom = document.getElementById('zoomControls');
    if (zoom) {
      var zr = zoom.getBoundingClientRect();
      if (zr.width > 0 && zr.height > 0) {
        return Math.max(76, Math.round(window.innerWidth - zr.left + 22));
      }
    }
    var sidebarWidth = _getSidebarWidth();
    return sidebarWidth ? sidebarWidth + 88 : 92;
  }
  function _chatBeginDrag() {
    // Exit move mode for all secondary windows.
    [1, 2, 3].forEach((sn) => _secExitMoveMode(sn));
    var rect = chatPanel.getBoundingClientRect();
    chatPanel.classList.remove('snap-left', 'snap-right'); chatPanel.classList.add('floating');
    chatPanel.classList.add('dragging');
    chatPanel.style.left = rect.left + 'px'; chatPanel.style.top = rect.top + 'px';
    chatPanel.style.right = 'auto'; chatPanel.style.bottom = 'auto'; chatPanel.style.width = rect.width + 'px'; chatPanel.style.height = rect.height + 'px';
    _chatOrigLeft = rect.left;
    _chatOrigTop = rect.top;
    _chatDragging = true;
    _chatCreateSnapZones();
  }
  function _chatExitMoveMode() {
    _chatDragCandidate = false;
    _chatDragPointerId = null;
    _chatDragging = false;
    chatPanel.classList.remove('floating', 'dragging', 'move-active');
    chatPanel.style.removeProperty('transform');
    _chatRemoveSnapZones();
    if (!chatPanel.classList.contains('snap-left') && !chatPanel.classList.contains('snap-right')) {
      chatPanel.style.left = ''; chatPanel.style.top = ''; chatPanel.style.right = ''; chatPanel.style.bottom = ''; chatPanel.style.width = ''; chatPanel.style.height = '';
    }
  }
  function _chatSnapTo(side) {
    chatPanel.classList.remove('floating', 'dragging', 'move-active');
    chatPanel.style.left = ''; chatPanel.style.right = ''; chatPanel.style.bottom = ''; chatPanel.style.width = '380px';
    var wrapper = document.getElementById('canvasWrapper') || document.querySelector('.game-wrapper');
    var wRect = wrapper ? wrapper.getBoundingClientRect() : { top: 0, height: window.innerHeight };
    chatPanel.style.top = wRect.top + 'px'; chatPanel.style.height = wRect.height + 'px';
    if (side === 'left') { chatPanel.classList.remove('snap-right'); chatPanel.classList.add('snap-left'); }
    else { chatPanel.classList.remove('snap-left'); chatPanel.classList.add('snap-right'); chatPanel.style.right = _getChatDockRightOffset() + 'px'; }
    _chatDragCandidate = false;
    _chatDragPointerId = null;
    _chatDragging = false;
    _chatRemoveSnapZones();
    setTimeout(() => { _tileSecondaryPanels(); _positionExteriorTabs(); _resolveOverlaps(chatPanel); }, 50);
  }
  function _chatUpdateSnapPosition() {
    if (chatPanel.classList.contains('snap-right')) chatPanel.style.right = _getChatDockRightOffset() + 'px';
    if (chatPanel.classList.contains('snap-left') || chatPanel.classList.contains('snap-right')) {
      var wrapper = document.getElementById('canvasWrapper') || document.querySelector('.game-wrapper');
      var wRect = wrapper ? wrapper.getBoundingClientRect() : { top: 0, height: window.innerHeight };
      chatPanel.style.top = wRect.top + 'px'; chatPanel.style.height = wRect.height + 'px';
    }
    requestAnimationFrame(_positionExteriorTabs);
  }
  var _sidebarEdge = document.getElementById('sidebar-edge');
  var _vwSidebarToggle = document.getElementById('btn-toggleSidebar');
  function _scheduleDockRefresh() {
    [120, 360, 720, 1100].forEach((delay) => setTimeout(() => {
      updateChatStackLayout();
      _chatUpdateSnapPosition();
      _positionExteriorTabs();
    }, delay));
  }
  if (_sidebarEdge) _sidebarEdge.addEventListener('click', _scheduleDockRefresh);
  if (_vwSidebarToggle) _vwSidebarToggle.addEventListener('click', _scheduleDockRefresh);
  window.addEventListener('resize', () => {
    enforceSingleWindowMobileLayout();
    updateChatStackLayout();
    _chatUpdateSnapPosition();
    _positionExteriorTabs();
  });
  const chatHeader = chatPanel.querySelector('.chat-header');
  chatHeader.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.isPrimary === false) return;
    if (e.target.closest('button, select, input, textarea, a, [role="button"]')) return;
    _chatDragCandidate = true;
    _chatDragPointerId = e.pointerId;
    _chatDragStartX = e.clientX;
    _chatDragStartY = e.clientY;
  });
  window.addEventListener('pointermove', (e) => {
    if (!_chatDragCandidate || e.pointerId !== _chatDragPointerId) return;
    var dx = e.clientX - _chatDragStartX; var dy = e.clientY - _chatDragStartY;
    if (!_chatDragging && Math.hypot(dx, dy) < CHAT_DRAG_THRESHOLD) return;
    if (!_chatDragging) _chatBeginDrag();
    if (!_chatDragging) return;
    e.preventDefault();
    chatPanel.style.left = (_chatOrigLeft + dx) + 'px'; chatPanel.style.top = (_chatOrigTop + dy) + 'px';
    _tileSecondaryPanels();
    _positionExteriorTabs();
    var sbW = _getChatDockRightOffset(); var rightEdge = window.innerWidth - sbW;
    if (_chatSnapZoneL) _chatSnapZoneL.classList.toggle('active', e.clientX < 80);
    if (_chatSnapZoneR) { _chatSnapZoneR.style.right = sbW + 'px'; _chatSnapZoneR.classList.toggle('active', e.clientX > rightEdge - 80); }
  });
  function _chatFinishPointerDrag(e, cancelled = false) {
    if (!_chatDragCandidate || e.pointerId !== _chatDragPointerId) return;
    _chatDragCandidate = false;
    _chatDragPointerId = null;
    if (!_chatDragging) return;
    _chatDragging = false; chatPanel.classList.remove('dragging');
    var sbW = _getChatDockRightOffset(); var rightEdge = window.innerWidth - sbW;
    if (!cancelled && e.clientX < 80) _chatSnapTo('left');
    else if (!cancelled && e.clientX > rightEdge - 80) _chatSnapTo('right');
    _chatRemoveSnapZones();
    _tileSecondaryPanels();
    _positionExteriorTabs();
    _resolveOverlaps(chatPanel);
  }
  window.addEventListener('pointerup', _chatFinishPointerDrag);
  window.addEventListener('pointercancel', (e) => _chatFinishPointerDrag(e, true));

  // ─── SHARED CHAT RESIZE SYSTEM (primary + secondary, all directions) ───
  const CHAT_MIN_W = 220;
  const CHAT_MAX_W_RATIO = 0.92;
  const CHAT_MIN_H = 250;
  const CHAT_MAX_H_RATIO = 0.95;

  // Collect primary panel handles
  const _primaryHandleEls = chatPanel.querySelectorAll('.chat-resize-handle');

  /** Generic resize state — one per panel, keyed by slotId */
  const _resizeStates = {};

  /** Detect which direction class a handle element has */
  function _getHandleDir(handleEl) {
    if (handleEl.classList.contains('top-left'))     return 'topLeft';
    if (handleEl.classList.contains('top-right'))    return 'topRight';
    if (handleEl.classList.contains('bottom-left'))  return 'bottomLeft';
    if (handleEl.classList.contains('bottom-right')) return 'bottomRight';
    if (handleEl.classList.contains('top'))    return 'top';
    if (handleEl.classList.contains('bottom')) return 'bottom';
    if (handleEl.classList.contains('left'))   return 'left';
    if (handleEl.classList.contains('right'))  return 'right';
    return null;
  }

  /** Is this panel anchored via CSS `right` (default docked mode)? */
  function _isRightAnchored(panel) {
    // Secondary panels are explicitly tiled with left positions, so their resize
    // math should behave like left/floating panels from the first drag.
    if (panel.classList.contains('chat-panel-secondary')) return false;
    // Floating or snapped-left panels are NOT right-anchored
    if (panel.classList.contains('floating') || panel.classList.contains('snap-left')) return false;
    // Default docked-right or snap-right panels ARE right-anchored
    return true;
  }

  /**
   * Apply a width+height resize delta to a panel, respecting min/max and
   * handling the difference between right-anchored and left/floating panels.
   *
   * @param {HTMLElement} panel — the chat-panel element
   * @param {Object} rs — resize state (startX, startY, startW, startH, startRect, dir)
   * @param {number} dx — mouse delta X (positive = moved right)
   * @param {number} dy — mouse delta Y (positive = moved down)
   */
  function _applyResizeDelta(panel, rs, dx, dy) {
    const maxW = Math.floor(window.innerWidth * CHAT_MAX_W_RATIO);
    const maxH = Math.floor(window.innerHeight * CHAT_MAX_H_RATIO);
    const dir = rs.dir;
    const rightAnchored = rs.rightAnchored;
    const { startW, startH, startRect } = rs;

    // Determine which axes this direction affects
    const movesLeft   = dir === 'left'   || dir === 'topLeft'    || dir === 'bottomLeft';
    const movesRight  = dir === 'right'  || dir === 'topRight'   || dir === 'bottomRight';
    const movesTop    = dir === 'top'    || dir === 'topLeft'    || dir === 'topRight';
    const movesBottom = dir === 'bottom' || dir === 'bottomLeft' || dir === 'bottomRight';

    // --- Horizontal resize ---
    if (movesRight) {
      if (panel.classList.contains('chat-panel-secondary')) panel.dataset.hasCustomWidth = '1';
      if (rightAnchored) {
        // Right edge is CSS-anchored — dragging right handle means we want the LEFT side to stay,
        // but CSS right is fixed. So we just widen by moving the right anchor inward (shrink) or expand.
        // Actually in right-anchored mode, dragging right edge outward goes INTO the sidebar.
        // More intuitive: dx>0 = wider. We grow leftward by increasing width.
        const newW = Math.min(Math.max(startW + dx, CHAT_MIN_W), maxW);
        panel.style.width = newW + 'px';
      } else {
        // Floating or left-snapped: right edge expands rightward
        const newW = Math.min(Math.max(startW + dx, CHAT_MIN_W), maxW);
        panel.style.width = newW + 'px';
      }
    }

    if (movesLeft) {
      if (panel.classList.contains('chat-panel-secondary')) panel.dataset.hasCustomWidth = '1';
      if (rightAnchored) {
        // Right-anchored: left edge resize simply changes width (right stays put)
        // dx < 0 = moved left = wider; dx > 0 = moved right = narrower
        const newW = Math.min(Math.max(startW - dx, CHAT_MIN_W), maxW);
        panel.style.width = newW + 'px';
      } else {
        // Floating/left-snap: left edge moves, right edge stays fixed
        const newW = Math.min(Math.max(startW - dx, CHAT_MIN_W), maxW);
        const widthDelta = newW - startW;
        panel.style.width = newW + 'px';
        panel.style.left = (startRect.left - widthDelta) + 'px';
      }
    }

    // --- Vertical resize ---
    if (movesTop) {
      // Top edge: dragging up = dy < 0 = taller
      const newH = Math.min(Math.max(startH - dy, CHAT_MIN_H), maxH);
      const heightDelta = newH - startH;
      panel.style.setProperty('height', newH + 'px', 'important');
      panel.style.setProperty('max-height', newH + 'px', 'important');
      // Adjust top position: for secondary panels (position:fixed with explicit top)
      // and for floating/snapped primary panels
      if (panel.classList.contains('chat-panel-secondary') ||
          panel.classList.contains('floating') || panel.classList.contains('snap-left') || panel.classList.contains('snap-right')) {
        panel.style.top = (startRect.top - heightDelta) + 'px';
      }
      // Mark secondary panels as having custom height so tiling doesn't override
      if (panel.classList.contains('chat-panel-secondary')) {
        panel.dataset.hasCustomHeight = '1';
      }
    }

    if (movesBottom) {
      // Bottom edge: dragging down = dy > 0.
      if (panel.classList.contains('chat-panel-secondary')) {
        // Secondary panels: bottom edge can grow downward (they have explicit positioning)
        const newH = Math.min(Math.max(startH + dy, CHAT_MIN_H), maxH);
        panel.style.setProperty('height', newH + 'px', 'important');
        panel.style.setProperty('max-height', newH + 'px', 'important');
        panel.dataset.hasCustomHeight = '1';
      } else if (panel.classList.contains('floating')) {
        const newH = Math.min(Math.max(startH + dy, CHAT_MIN_H), maxH);
        panel.style.setProperty('height', newH + 'px', 'important');
        panel.style.setProperty('max-height', newH + 'px', 'important');
      } else {
        // Default docked primary panel is bottom-anchored. Let the bottom handle
        // resize height too; the browser keeps the bottom edge fixed and moves
        // the top edge, which makes all four sides/corners usable.
        const newH = Math.min(Math.max(startH + dy, CHAT_MIN_H), maxH);
        panel.style.setProperty('height', newH + 'px', 'important');
        panel.style.setProperty('max-height', newH + 'px', 'important');
      }
    }
  }

  function _chatResizeStart(panel, handleEl, e) {
    const dir = _getHandleDir(handleEl);
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    // Activate this panel so it gets highest z-index (prevents overlapping panels from blocking)
    const chatSlot = panel.dataset.chatSlot || '';
    if (chatSlot.startsWith('secondary-')) {
      const slotNum = chatSlot.replace('secondary-', '');
      panel.dataset.resizeActive = '1';
      panel.dataset.hasCustomWidth = '1';
      if (typeof setActiveSecondarySlot === 'function') setActiveSecondarySlot(slotNum);
    }
    const rect = panel.getBoundingClientRect();
    if (chatSlot.startsWith('secondary-')) {
      // Secondary panels are tiled with a mix of top/bottom/height. Browsers
      // treat that as over-constrained for vertical resizing, so the first drag
      // can look like the whole panel moves. Match the stable VO behavior by
      // freezing the visual rect into explicit left/top/width/height for the
      // resize gesture, then all side/corner math operates on a normal fixed box.
      panel.classList.add('floating');
      panel.style.setProperty('transform', 'none', 'important');
      panel.style.left = rect.left + 'px';
      panel.style.top = rect.top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.width = rect.width + 'px';
      panel.style.height = rect.height + 'px';
    }
    const slotId = chatSlot || 'primary';
    _resizeStates[slotId] = {
      active: true,
      panel,
      handleEl,
      dir,
      rightAnchored: _isRightAnchored(panel),
      startX: e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX,
      startY: e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY,
      startW: rect.width,
      startH: rect.height,
      startRect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
    };
    panel.style.transition = 'none';
    handleEl.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
    // Lock cursor to resize direction for the entire drag (prevents cursor flicker
    // when mouse moves off the narrow handle zone)
    const cursorMap = {
      left: 'ew-resize', right: 'ew-resize',
      top: 'ns-resize', bottom: 'ns-resize',
      topLeft: 'nw-resize', topRight: 'ne-resize',
      bottomLeft: 'sw-resize', bottomRight: 'se-resize',
    };
    document.body.style.cursor = cursorMap[dir] || 'default';
  }

  function _chatResizeMove(e) {
    let activeSecondaryResize = false;
    for (const slotId in _resizeStates) {
      const rs = _resizeStates[slotId];
      if (!rs || !rs.active) continue;
      if (rs.panel.classList.contains('chat-panel-secondary')) activeSecondaryResize = true;
      const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
      const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
      const dx = clientX - rs.startX;
      const dy = clientY - rs.startY;
      _applyResizeDelta(rs.panel, rs, dx, dy);
    }
    // Do not re-tile while a secondary window is actively resizing. Re-tiling
    // repositions secondary panels from the main panel and makes the first drag
    // look like it is moving the whole window instead of resizing it.
    if (!activeSecondaryResize) _tileSecondaryPanels();
    _positionExteriorTabs();
  }

  function _chatResizeEnd() {
    let resizedPanels = [];
    for (const slotId in _resizeStates) {
      const rs = _resizeStates[slotId];
      if (!rs || !rs.active) continue;
      rs.active = false;
      delete rs.panel.dataset.resizeActive;
      rs.handleEl.classList.remove('dragging');
      rs.panel.style.transition = '';
      resizedPanels.push(rs.panel);
      // Scroll chat to bottom after resize
      const w = chatWindowsByRoot.get(rs.panel);
      if (w) w.scrollBottom();
    }
    document.body.style.userSelect = '';
    document.body.style.webkitUserSelect = '';
    document.body.style.cursor = '';
    // Re-tile after primary resizes only. Secondary resizes preserve the user's
    // manually dragged size/position immediately, including the very first drag.
    const resizedSecondary = resizedPanels.some(p => p.classList.contains('chat-panel-secondary'));
    if (!resizedSecondary) _tileSecondaryPanels();
    _positionExteriorTabs();
    if (!resizedSecondary) resizedPanels.forEach(p => _resolveOverlaps(p));
  }

  // Bind resize events for PRIMARY panel
  _primaryHandleEls.forEach(handle => {
    handle.addEventListener('mousedown', (e) => _chatResizeStart(chatPanel, handle, e));
    handle.addEventListener('touchstart', (e) => _chatResizeStart(chatPanel, handle, e), { passive: false });
  });

  // Bind resize events for SECONDARY panels
  [1, 2, 3].forEach((slotNum) => {
    const slotKey = String(slotNum);
    const panel = secondaryChatPanels[slotKey];
    if (!panel) return;
    const handles = panel.querySelectorAll('.chat-resize-handle');
    handles.forEach(handle => {
      handle.addEventListener('mousedown', (e) => _chatResizeStart(panel, handle, e));
      handle.addEventListener('touchstart', (e) => _chatResizeStart(panel, handle, e), { passive: false });
    });
  });

  // Global move/end listeners (shared for all panels)
  document.addEventListener('mousemove', _chatResizeMove);
  document.addEventListener('touchmove', _chatResizeMove, { passive: false });
  document.addEventListener('mouseup', _chatResizeEnd);
  document.addEventListener('touchend', _chatResizeEnd);

  // ─── OVERLAP PREVENTION SYSTEM ───
  // After any move/resize/snap, push overlapping chat windows apart.
  // Uses getBoundingClientRect() for detection (always accurate for visual position)
  // and converts pushed panels to floating with explicit left/top positioning.

  const OVERLAP_PAD = 8; // minimum gap (px) between windows

  /** Get all open, visible chat panels (primary + secondaries) */
  function _getAllOpenChatPanels() {
    const panels = [];
    if (chatPanel.classList.contains('open')) panels.push(chatPanel);
    [1, 2, 3].forEach((slotNum) => {
      const p = secondaryChatPanels[String(slotNum)];
      if (p && p.classList.contains('open')) panels.push(p);
    });
    return panels;
  }

  /**
   * Read a panel's position. For floating panels with explicit inline styles,
   * reads from style.left/top (avoids stale CSS-transform issues). Otherwise
   * falls back to getBoundingClientRect (reliable for stacked/docked panels).
   */
  function _getPanelRect(panel) {
    // Floating panels: trust inline styles as source of truth
    if (panel.classList.contains('floating')) {
      const l = parseFloat(panel.style.left);
      const t = parseFloat(panel.style.top);
      if (!isNaN(l) && !isNaN(t)) {
        const w = parseFloat(panel.style.width) || panel.offsetWidth || 300;
        const h = parseFloat(panel.style.height) || panel.offsetHeight || 500;
        return { left: l, top: t, right: l + w, bottom: t + h, width: w, height: h };
      }
    }
    // Docked/stacked panels: getBoundingClientRect reflects transforms correctly
    const r = panel.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }

  /** Check if two rects overlap (accounting for minimum gap) */
  function _rectsOverlap(a, b, pad) {
    return !(a.right + pad <= b.left || b.right + pad <= a.left ||
             a.bottom + pad <= b.top || b.bottom + pad <= a.top);
  }

  /**
   * Convert a panel from stacked/docked layout to floating so we can
   * reposition it freely. Captures getBoundingClientRect BEFORE adding
   * the floating class, then applies all styles in one cssText batch
   * to avoid layout thrash.
   */
  function _convertToFloating(panel) {
    // Already floating — just make sure transform is killed
    if (panel.classList.contains('floating') || panel.classList.contains('snap-left') || panel.classList.contains('snap-right')) {
      panel.style.setProperty('transform', 'none', 'important');
      return;
    }
    // Capture current visual position (getBoundingClientRect includes CSS transforms)
    const rect = panel.getBoundingClientRect();
    // Apply floating class + all position props in one batch
    panel.classList.add('floating');
    panel.style.cssText = 'transform: none !important; left: ' + rect.left + 'px; top: ' + rect.top + 'px; right: auto; bottom: auto; width: ' + rect.width + 'px; height: ' + rect.height + 'px;';
  }

  /**
   * After a panel is moved/resized/snapped, detect and resolve overlaps
   * with all other open chat windows. The moved panel stays put;
   * overlapping neighbors get pushed out of the way.
   *
   * Algorithm: multi-pass pairwise resolution with viewport clamping.
   * On each pass, every overlapping pair is resolved by pushing the
   * non-mover in the shortest-escape direction. If a horizontal push
   * would send the panel off-screen, a vertical push is tried instead.
   * Up to 8 passes handle cascading shifts.
   */
  function _resolveOverlaps(movedPanel) {
    const allPanels = _getAllOpenChatPanels();
    if (allPanels.length < 2) return;

    // First, convert any non-floating panels to floating so we can
    // position them via style.left/top. Do this BEFORE reading rects
    // to avoid mid-loop transform issues.
    allPanels.forEach(p => {
      if (p !== movedPanel) _convertToFloating(p);
    });

    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    const sbW = _getChatDockRightOffset();
    const usableRight = viewW - sbW;
    const minVisible = 100;
    const maxPasses = 8;

    // Build mutable position map: panel → {left, top, width, height}
    // For the moved panel, use getBoundingClientRect (it may not be floating)
    const posMap = new Map();
    allPanels.forEach(p => {
      const r = _getPanelRect(p);
      posMap.set(p, { left: r.left, top: r.top, width: r.width, height: r.height });
    });

    function getRect(p) {
      const pos = posMap.get(p);
      return { left: pos.left, top: pos.top, right: pos.left + pos.width, bottom: pos.top + pos.height, width: pos.width, height: pos.height };
    }

    for (let pass = 0; pass < maxPasses; pass++) {
      let anyMoved = false;

      for (let i = 0; i < allPanels.length; i++) {
        for (let j = i + 1; j < allPanels.length; j++) {
          const pA = allPanels[i], pB = allPanels[j];
          const rA = getRect(pA), rB = getRect(pB);

          if (!_rectsOverlap(rA, rB, OVERLAP_PAD)) continue;

          // Decide who moves: never move the movedPanel
          let fixed, push, fR, pR;
          if (pA === movedPanel) { fixed = pA; push = pB; fR = rA; pR = rB; }
          else if (pB === movedPanel) { fixed = pB; push = pA; fR = rB; pR = rA; }
          else {
            // Neither is the moved panel — push whichever is further from mover
            const mR = getRect(movedPanel);
            const dA = Math.abs((rA.left + rA.width / 2) - (mR.left + mR.width / 2));
            const dB = Math.abs((rB.left + rB.width / 2) - (mR.left + mR.width / 2));
            if (dA >= dB) { fixed = pB; push = pA; fR = rB; pR = rA; }
            else { fixed = pA; push = pB; fR = rA; pR = rB; }
          }

          // Calculate shortest escape direction
          const overlapX = Math.min(fR.right, pR.right) - Math.max(fR.left, pR.left);
          const overlapY = Math.min(fR.bottom, pR.bottom) - Math.max(fR.top, pR.top);
          const fCX = (fR.left + fR.right) / 2, fCY = (fR.top + fR.bottom) / 2;
          const pCX = (pR.left + pR.right) / 2, pCY = (pR.top + pR.bottom) / 2;

          // Try up to 4 candidate positions (preferred direction, opposite, then other axis)
          // and pick the first that resolves the overlap while staying in viewport.
          const candidates = [];

          // Preferred axis first (shorter escape)
          if (overlapX <= overlapY) {
            // Horizontal preferred
            if (pCX >= fCX) {
              candidates.push({ l: fR.right + OVERLAP_PAD, t: pR.top });             // right
              candidates.push({ l: fR.left - pR.width - OVERLAP_PAD, t: pR.top });   // left
            } else {
              candidates.push({ l: fR.left - pR.width - OVERLAP_PAD, t: pR.top });   // left
              candidates.push({ l: fR.right + OVERLAP_PAD, t: pR.top });             // right
            }
            // Fallback: vertical
            candidates.push({ l: pR.left, t: fR.bottom + OVERLAP_PAD });             // down
            candidates.push({ l: pR.left, t: fR.top - pR.height - OVERLAP_PAD });    // up
          } else {
            // Vertical preferred
            if (pCY >= fCY) {
              candidates.push({ l: pR.left, t: fR.bottom + OVERLAP_PAD });           // down
              candidates.push({ l: pR.left, t: fR.top - pR.height - OVERLAP_PAD });  // up
            } else {
              candidates.push({ l: pR.left, t: fR.top - pR.height - OVERLAP_PAD });  // up
              candidates.push({ l: pR.left, t: fR.bottom + OVERLAP_PAD });           // down
            }
            // Fallback: horizontal
            candidates.push({ l: fR.right + OVERLAP_PAD, t: pR.top });               // right
            candidates.push({ l: fR.left - pR.width - OVERLAP_PAD, t: pR.top });     // left
          }

          // Evaluate each candidate: prefer one that doesn't overlap with ANY other panel
          let newLeft = pR.left, newTop = pR.top;
          let bestScore = -1;
          for (const c of candidates) {
            const cl = Math.max(0, Math.min(c.l, usableRight - minVisible));
            const ct = Math.max(0, Math.min(c.t, viewH - minVisible));
            const tr = { left: cl, top: ct, right: cl + pR.width, bottom: ct + pR.height };
            // Must not overlap the fixed panel
            if (_rectsOverlap(fR, tr, OVERLAP_PAD)) continue;
            // Count how many OTHER panels it would overlap (fewer = better)
            let collisions = 0;
            for (let k = 0; k < allPanels.length; k++) {
              if (allPanels[k] === push || allPanels[k] === fixed) continue;
              if (_rectsOverlap(getRect(allPanels[k]), tr, OVERLAP_PAD)) collisions++;
            }
            const score = 100 - collisions; // higher is better
            if (score > bestScore) {
              bestScore = score; newLeft = cl; newTop = ct;
              if (collisions === 0) break; // perfect placement found
            }
          }
          if (bestScore < 0) {
            // No candidate avoids the fixed panel — use first clamped as fallback
            newLeft = Math.max(0, Math.min(candidates[0].l, usableRight - minVisible));
            newTop = Math.max(0, Math.min(candidates[0].t, viewH - minVisible));
          }

          // Update the position map
          const pos = posMap.get(push);
          pos.left = newLeft;
          pos.top = newTop;
          anyMoved = true;
        }
      }
      if (!anyMoved) break;
    }

    // Apply final positions to DOM (skip the moved panel)
    allPanels.forEach(p => {
      if (p === movedPanel) return;
      const pos = posMap.get(p);
      p.style.left = pos.left + 'px';
      p.style.top = pos.top + 'px';
    });
  }

  // No-op stubs for backward compat (secondary panels no longer have independent move)
  function _secExitMoveMode() {}

  window._secExitMoveMode = _secExitMoveMode;
  window._resolveOverlaps = _resolveOverlaps;
  window._convertToFloating = _convertToFloating;
  window._getPanelRect = _getPanelRect;
})();
