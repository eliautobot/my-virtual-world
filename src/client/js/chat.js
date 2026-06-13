// Virtual World Chat — Gateway WebSocket Client (Multi-Window, ported from Virtual Office)
(() => {
  let GATEWAY_TOKEN = '';
  let GATEWAY_URL = '';
  let ws = null;
  let reqId = 0;
  let connected = false;
  let pendingCallbacks = {};
  let _chatWsPort = null;
  let GATEWAY_CLIENT_VERSION = 'unknown';
  let _modelBarInterval = null;
  let gatewayAuthFailed = false;
  let gatewayAuthFailureMessage = '';
  let lastGatewayToken = null;
  const runOwners = new Map();
  const LOCAL_GATEWAY_HOSTS = new Set(['127.0.0.1', 'localhost', '0.0.0.0', 'host.docker.internal']);

  async function loadGatewayInfo() {
    try {
      const r = await fetch('/gateway-info', { cache: 'no-store' });
      const d = await r.json();
      if (d.wsPort) _chatWsPort = d.wsPort;
      GATEWAY_URL = typeof d.gatewayUrl === 'string' ? d.gatewayUrl.trim() : '';
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

  const gatewayInfoReady = loadGatewayInfo();

  const MAX_INPUT_LINES = 15;
  const TOOL_RENDER_INTERVAL_MS = 80;
  const MAX_LIVE_TOOL_CARDS = 24;
  const CHAT_STACK_GAP = 12;
  const CHAT_BOTTOM_OFFSET = 36;
  const HERMES_APPROVAL_POLL_MS = 1500;
  const CHAT_SELECTION_STORAGE_KEY = 'vw-chat-selection-v1';
  const secondarySlotButtons = Array.from(document.querySelectorAll('[data-chat-slot-toggle]'));
  let activeSecondarySlot = null;
  const secondaryPanelPlaceholders = {
    1: document.getElementById('chat-secondary-1'),
    2: document.getElementById('chat-secondary-2'),
    3: document.getElementById('chat-secondary-3')
  };
  let secondaryChatPanels = {};

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

  class ChatWindow {
    constructor(root, options = {}) {
      this.root = root;
      this.isPrimary = !!options.isPrimary;
      this.slot = options.slot || null;
      this.slotId = this.isPrimary ? 'primary' : `secondary-${this.slot}`;
      this.root.dataset.chatSlot = this.slotId;
      const savedSelection = getSavedChatSelection(this.slotId);
      this.agentList = [];
      this.selectedAgentKey = options.selectedAgentKey || savedSelection?.selectedAgentKey || 'main';
      this.sessionKey = options.sessionKey || savedSelection?.sessionKey || 'agent:main:main';
      this.hasExplicitAgentSelection = !!savedSelection;
      this.currentRunId = null;
      this.streamingMsg = null;
      this.liveToolCards = new Map();
      this.pendingToolEvents = new Map();
      this.toolFlushTimer = null;
      this.hermesProgressTimers = [];
      this.hermesLivePollTimer = null;
      this.hermesLiveEventSeq = 0;
      this.hermesApprovalPollTimer = null;
      this.hermesApprovalLastId = '';
      this.scrollFrame = null;
      this.lastLiveEventAt = 0;
      this.sessionModel = '—';
      this.contextWindow = 0;
      this.contextUsed = 0;
      this.pendingAttachments = [];
      this.isRecording = false;
      this.mediaRecorder = null;
      this.audioChunks = [];

      this.messages = root.querySelector('.chat-messages');
      this.status = root.querySelector('.chat-status');
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

      this.messages.addEventListener('click', (e) => {
        if (e.target.classList.contains('chat-image-clickable') || e.target.classList.contains('chat-image-thumb')) {
          openImageLightbox(e.target.src);
        }
      });

      this.agentSelect?.addEventListener('change', () => {
        const opt = this.agentSelect.selectedOptions[0];
        if (!opt) return;
        this.applySelection(opt, { markExplicit: true, systemPrefix: 'Switched to' });
      });

      this.sendBtn?.addEventListener('click', () => this.sendMessage());
      this.stopBtn?.addEventListener('click', () => this.sendStop());
      this.input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });
      this.input?.addEventListener('input', () => this.autoResizeInput());
      this.input?.addEventListener('keyup', () => this.autoResizeInput());
      this.input?.addEventListener('change', () => this.autoResizeInput());
      this.input?.addEventListener('compositionend', () => this.autoResizeInput());
      this.input?.addEventListener('paste', (e) => this.handlePaste(e));

      this.attachBtn?.addEventListener('click', () => this.fileInput?.click());
      this.fileInput?.addEventListener('change', () => this.handleFiles());
      this.micBtn?.addEventListener('click', () => this.toggleRecording());
      this.newSessionBtn?.addEventListener('click', () => this.newSession());
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
      this.messages.innerHTML = '';
      this.streamingMsg = null;
      this.currentRunId = null;
      this.sessionModel = '—';
      this.contextWindow = 0;
      this.contextUsed = 0;
      this.updateModelBar();
      if (systemText) this.appendSystem(systemText);
    }

    setStatus(text, cls) {
      if (!this.status) return;
      this.status.textContent = text;
      this.status.className = 'chat-status ' + (cls || '');
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
      if (this.contextWindow > 0 && this.contextUsed > 0) {
        this.contextInfo.textContent = this.formatTokens(this.contextUsed) + ' / ' + this.formatTokens(this.contextWindow);
      } else if (this.contextWindow > 0) {
        this.contextInfo.textContent = '— / ' + this.formatTokens(this.contextWindow);
      } else {
        this.contextInfo.textContent = '';
      }
    }

    autoResizeInput() {
      if (!this.input) return;
      const styles = getComputedStyle(this.input);
      const fontSize = parseFloat(styles.fontSize) || 14;
      const lineHeight = (parseFloat(styles.lineHeight) || fontSize * 1.4);
      const inputMaxHeight = lineHeight * MAX_INPUT_LINES;
      this.input.style.setProperty('height', 'auto', 'important');
      const newHeight = Math.min(this.input.scrollHeight, inputMaxHeight);
      this.input.style.setProperty('height', newHeight + 'px', 'important');
      this.input.style.overflowY = this.input.scrollHeight > inputMaxHeight ? 'auto' : 'hidden';
    }

    syncAgentSelect() {
      if (!this.agentSelect) return;
      const options = Array.from(this.agentSelect.querySelectorAll('option'));
      let matched = false;
      for (const opt of options) {
        const isMatch = opt.value === this.selectedAgentKey && opt.dataset.sessionKey === this.sessionKey;
        opt.selected = isMatch;
        if (isMatch) matched = true;
      }
      if (!matched) {
        const fallback = options.find(opt => opt.value === this.selectedAgentKey) || options.find(opt => opt.dataset.sessionKey === this.sessionKey) || options[0];
        if (fallback) {
          fallback.selected = true;
          this.selectedAgentKey = fallback.value;
          this.sessionKey = fallback.dataset.sessionKey || this.sessionKey;
          this.saveSelection();
        }
      }
    }

    saveSelection() {
      saveChatSelection(this.slotId, {
        selectedAgentKey: this.selectedAgentKey,
        sessionKey: this.sessionKey
      });
    }

    applySelection(opt, { markExplicit = false, systemPrefix = 'Switched to' } = {}) {
      if (!opt) return;
      const newSessionKey = opt.dataset.sessionKey;
      const newAgentKey = opt.value;
      if (newSessionKey === this.sessionKey && newAgentKey === this.selectedAgentKey) {
        if (markExplicit) {
          this.hasExplicitAgentSelection = true;
          this.saveSelection();
        }
        return;
      }
      this.selectedAgentKey = newAgentKey;
      this.sessionKey = newSessionKey;
      if (markExplicit) this.hasExplicitAgentSelection = true;
      this.saveSelection();
      this.currentRunId = null;
      this.streamingMsg = null;
      this.syncAgentSelect();
      this.resetConversation(`${systemPrefix} ${opt.textContent.trim()}`);
      if (this.isHermesSelected()) this.startHermesApprovalPolling();
      else this.stopHermesApprovalPolling();
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
            opt.textContent = `${a.emoji} ${a.name}`;
            opt.dataset.sessionKey = a.sessionKey;
            opt.dataset.agentId = a.agentId;
            opt.dataset.providerKind = a.providerKind || 'openclaw';
            opt.dataset.providerAgentId = a.providerAgentId || a.agentId;
            group.appendChild(opt);
          }
          this.agentSelect.appendChild(group);
        }
        this.syncAgentSelect();
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

    isHermesSelected() {
      return this.getSelectedProviderKind() === 'hermes' || String(this.sessionKey || '').startsWith('hermes:');
    }

    isProviderAgentSelected() {
      return this.getSelectedProviderKind() !== 'openclaw' || this.isHermesSelected();
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

    appendHermesPendingApproval(approval, pendingCount = 1) {
      if (!approval) return;
      const approvalId = approval.approval_id || approval.id || '';
      if (approvalId) {
        const existing = [...this.messages.querySelectorAll('[data-approval-id]')].find(el => el.dataset.approvalId === approvalId);
        if (existing) return;
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

    async fetchSessionInfo() {
      let gatewayContext = 0;
      try {
        if (this.isProviderAgentSelected()) return;
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
      let serverContext = 0;
      try {
        // Pass current agent ID so server returns the correct configured model
        const agentId = this.getSelectedAgentId();
        const qs = agentId ? `?agent=${encodeURIComponent(agentId)}` : '';
        const res = await fetch('/session-info' + qs);
        const data = await res.json();
        // Always use the configured model from the server — this reflects
        // what the agent is SET to use, not what was last used historically.
        // The gateway transcript model can be stale (from before a model change).
        if (data.model) this.sessionModel = data.model;
        if (data.contextWindow) serverContext = data.contextWindow;
      } catch (e) {
        console.warn('[chat] /session-info failed:', e);
      }
      this.contextWindow = Math.max(gatewayContext, serverContext);
      this.updateModelBar();
    }

    async loadHistory() {
      try {
        if (this.isHermesSelected()) {
          this.startHermesApprovalPolling();
          const res = await fetch('/api/hermes/history?agentId=' + encodeURIComponent(this.getSelectedAgentId() || this.selectedAgentKey));
          const data = await res.json();
          if (data.ok && Array.isArray(data.messages)) {
            this.messages.innerHTML = '';
            for (const msg of data.messages) {
              if (msg.text || msg.thinking || msg.approval || (Array.isArray(msg.tools) && msg.tools.length)) {
                const meta = msg.role === 'assistant'
                  ? {
                      ...resolveMessageSender(msg, this),
                      thinking: msg.thinking || '',
                      reasoningTokens: msg.reasoningTokens || 0,
                      approval: msg.approval || null
                    }
                  : { label: 'You', kind: 'human' };
                this.appendMessage(msg.role || 'assistant', msg.text || '', msg.ts || msg.epochMs || Date.now(), [], meta, normalizeHermesTools(msg.tools || []));
              }
            }
            this.scrollBottom();
          }
          await this.pollHermesApproval().catch(() => {});
          return;
        }
        if (this.isProviderAgentSelected()) {
          const res = await fetch('/api/agent-chat');
          const data = await res.json();
          const msgs = data[this.selectedAgentKey] || [];
          this.messages.innerHTML = '';
          for (const msg of msgs) {
            const tools = normalizeHermesTools(msg.tools || []);
            const meta = msg.role === 'user'
              ? { label: msg.from || 'Agent', kind: msg.fromType === 'human' ? 'human' : 'agent' }
              : {
                  label: msg.from || this.agentSelect.selectedOptions[0]?.textContent.trim() || 'Agent',
                  kind: 'agent',
                  thinking: msg.thinking || '',
                  reasoningTokens: msg.reasoningTokens || 0,
                  approval: msg.approval || null
                };
            if (msg.text || tools.length || msg.thinking || msg.reasoningTokens || msg.approval) {
              this.appendMessage(msg.role || 'assistant', msg.text || '', msg.ts || msg.epochMs || Date.now(), [], meta, tools);
            }
          }
          this.scrollBottom();
          return;
        }
        const res = await rpc('chat.history', { sessionKey: this.sessionKey, limit: 500 });
        if (res.ok && res.payload?.messages) {
          this.messages.innerHTML = '';
          for (const msg of res.payload.messages) {
            const t = extractText(msg) || (typeof msg.content === 'string' ? msg.content : '');
            const ts = msg.timestamp || msg.ts || msg.message?.timestamp || null;
            const media = extractMedia(msg, t);
            const tools = extractToolItems(msg);
            if (t || media.length || tools.length) this.appendMessage(msg.role, t, ts, media, resolveMessageSender(msg, this), tools);
          }
          this.scrollBottom();
        }
      } catch (e) {
        console.warn('Failed to load history:', e);
      }
    }

    async newSession() {
      if (!connected) { this.appendSystem('Not connected'); return; }
      const agentName = this.agentSelect.selectedOptions[0]?.textContent.trim() || 'this agent';
      if (!confirm(`Start a new session for ${agentName}? This clears the conversation history.`)) return;
      try {
        if (this.isHermesSelected()) {
          const res = await fetch('/api/hermes/history/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId: this.getSelectedAgentId() || this.selectedAgentKey })
          });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || res.statusText);
          this.resetConversation('New Hermes session started');
          return;
        }
        const res = await rpc('sessions.reset', { key: this.sessionKey });
        if (res.ok) {
          this.messages.innerHTML = '';
          this.streamingMsg = null;
          this.currentRunId = null;
          this.liveToolCards.clear();
          this.appendSystem('New session started');
        } else {
          this.appendSystem('Reset failed: ' + JSON.stringify(res.error || res));
        }
      } catch (e) {
        this.appendSystem('Reset error: ' + e.message);
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
      let text = this.input.value.trim();
      const hasAttachments = this.pendingAttachments.length > 0;
      if ((!text && !hasAttachments) || (!connected && !this.isProviderAgentSelected())) return;

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
        attachments = imageAtts.length ? imageAtts : undefined;
      }

      this.pendingAttachments = [];
      this.renderAttachmentPreviews();

      const params = { sessionKey: this.sessionKey, message: text || '(attached files)', idempotencyKey: `vw-${Date.now()}-${Math.random().toString(36).slice(2)}` };
      if (attachments?.length) params.attachments = attachments;

      if (this.isHermesSelected()) {
        const hermesLabel = this.agentSelect.selectedOptions[0]?.textContent.trim() || 'Hermes';
        const hermesProgress = this.startHermesProgress(hermesLabel);
        try {
          const resp = await fetch('/api/hermes/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId: this.getSelectedAgentId() || this.selectedAgentKey,
              message: text || '(attached files)',
              liveRunId: hermesProgress?.runId || '',
              timeoutSec: 180,
              fromType: 'human',
              fromDisplayName: 'User',
              sourceApp: 'virtual-world',
              sourceSurface: 'chat-window',
              sourceLabel: 'Virtual World Chat'
            })
          });
          const data = await resp.json();
          this.finishHermesProgress(hermesProgress, true);
          this.removeTypingIndicator();
          const hermesTools = normalizeHermesTools(data.tools || []);
          const hasRenderableHermesReply = !!(data.reply || data.thinking || data.reasoningTokens || data.approval || hermesTools.length);
          if (!resp.ok || data.ok === false) {
            if (hasRenderableHermesReply) {
              this.appendMessage(
                'assistant',
                data.reply || '',
                Date.now(),
                [],
                {
                  label: hermesLabel,
                  kind: 'agent',
                  thinking: data.thinking || '',
                  reasoningTokens: data.reasoningTokens || 0,
                  approval: data.approval || null
                },
                hermesTools
              );
              if (!data.approval) this.appendSystem('Hermes returned an error response: ' + (data.error || resp.statusText));
            } else {
              throw new Error(data.error || resp.statusText);
            }
          } else {
            this.appendMessage(
              'assistant',
              data.reply || '',
              Date.now(),
              [],
              {
                label: hermesLabel,
                kind: 'agent',
                thinking: data.thinking || '',
                reasoningTokens: data.reasoningTokens || 0,
                approval: data.approval || null
              },
              hermesTools
            );
          }
          await this.pollHermesApproval().catch(() => {});
          this.setStatus('Hermes ready', 'connected');
          this.scrollBottom();
        } catch (e) {
          this.finishHermesProgress(hermesProgress, false, e.message);
          this.removeTypingIndicator();
          this.appendSystem('Hermes send failed: ' + e.message);
          this.setStatus('Hermes error', 'disconnected');
        }
        return;
      }

      if (this.isProviderAgentSelected()) {
        const providerLabel = this.agentSelect.selectedOptions[0]?.textContent.trim() || 'Agent';
        this.setStatus('Sending via Virtual World...', 'connecting');
        try {
          const resp = await fetch('/api/agent-platform-communications/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fromType: 'human',
              fromDisplayName: 'User',
              sourceApp: 'virtual-world',
              sourceSurface: 'chat-window',
              sourceLabel: 'Virtual World Chat',
              fromAgentId: 'main',
              toAgentId: this.getSelectedAgentId() || this.selectedAgentKey,
              message: text || '(attached files)',
              conversationId: `vw-chat-main-${this.getSelectedAgentId() || this.selectedAgentKey}`,
              timeoutSec: 180
            })
          });
          const data = await resp.json();
          this.removeTypingIndicator();
          if (!resp.ok || data.ok === false) throw new Error(data.error || data.reply || resp.statusText);
          this.appendMessage(
            'assistant',
            data.reply || '',
            Date.now(),
            [],
            {
              label: providerLabel,
              kind: 'agent',
              thinking: data.thinking || '',
              reasoningTokens: data.reasoningTokens || 0,
              approval: data.approval || null
            },
            normalizeHermesTools(data.tools || [])
          );
          this.setStatus('Connected', 'connected');
          this.scrollBottom();
        } catch (e) {
          this.removeTypingIndicator();
          this.appendSystem('Provider send failed: ' + e.message);
          this.setStatus('Error', 'disconnected');
        }
        return;
      }

      const sendSessionKey = this.sessionKey;
      rpc('chat.send', params).then(res => {
        if (res.ok && res.payload?.runId) {
          this.currentRunId = res.payload.runId;
          runOwners.set(res.payload.runId, { slotId: this.slotId, sessionKey: sendSessionKey });
        }
      }).catch(e => this.appendSystem('Failed to send: ' + e.message));
    }

    async sendStop() {
      try {
        if (this.streamingMsg) {
          this.finalizeStreamingMessage(this.streamingMsg.content || '');
          this.streamingMsg = null;
        }
        const params = { sessionKey: this.sessionKey };
        if (this.currentRunId) params.runId = this.currentRunId;
        const res = await rpc('chat.abort', params);
        if (res?.ok === false) throw new Error(res.error?.message || 'abort failed');
        this.clearActivityFeed();
        this.currentRunId = null;
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
          this.autoResizeInput();
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

    handleChatEvent(payload) {
      if (!this.ownsPayload(payload)) return;
      const text = extractText(payload);
      if (payload?.state === 'delta' || payload?.state === 'streaming') {
        if (!this.streamingMsg || this.streamingMsg.id !== payload.runId) {
          this.streamingMsg = { id: payload.runId, role: 'assistant', content: '' };
          this.appendStreamingMessage();
        }
        if (text) {
          this.streamingMsg.content = text;
          this.updateStreamingMessage(this.streamingMsg.content);
        }
        this.scrollBottom();
      } else if (payload?.state === 'final' || payload?.state === 'done') {
        const finalText = text || (this.streamingMsg ? this.streamingMsg.content : '');
        this.flushToolEvents(true);
        this.clearActivityFeed();
        if (this.streamingMsg) {
          this.finalizeStreamingMessage(finalText);
          this.streamingMsg = null;
        } else if (finalText) {
          this.appendMessage('assistant', finalText);
        }
        this.fetchContextUsage();
        if (payload?.runId) this.finalizeRunToolCards(payload.runId);
        if (payload?.runId) runOwners.delete(payload.runId);
        this.currentRunId = null;
        this.scrollBottom();
      }
    }

    handleAgentEvent(payload) {
      if (!this.ownsPayload(payload)) return;

      const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
      const stream = payload?.stream || data.stream || '';
      const phase = data.phase || payload?.phase || '';
      const isToolLikeItem = stream === 'item' && data.kind === 'command';

      // Current OpenClaw emits tool activity as agent events:
      // { stream:"tool", data:{ phase:"start|update|result", name, toolCallId, args, result } }
      if (stream === 'tool' || isToolLikeItem || payload?.type === 'tool_start' || payload?.type === 'tool_end' || payload?.type === 'tool_result') {
        this.markLiveEvent();
        const tool = normalizeToolEvent(payload, phase === 'result' ? 'done' : 'running');
        const label = formatToolLabel(tool.name, coerceToolArgs(tool.arguments));
        this.updateTypingIndicator((phase === 'result' || phase === 'end' || payload?.type === 'tool_end' || payload?.type === 'tool_result') ? 'Processing...' : label);
        this.queueToolEvent(payload);
        return;
      }

      if (payload?.type === 'thinking' || stream === 'lifecycle' && phase === 'start') {
        this.updateTypingIndicator('Thinking...');
      }
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
        const textDiv = document.createElement('div');
        textDiv.innerHTML = formatContent(displayContent);
        bubble.appendChild(textDiv);
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

    appendStreamingMessage() {
      this.removeTypingIndicator();
      const existing = this.messages.querySelector('.streaming-msg');
      if (existing) existing.classList.remove('streaming-msg');
      const div = document.createElement('div');
      div.className = 'chat-msg assistant streaming-msg';
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble streaming';
      bubble.innerHTML = '<span class="cursor">▊</span>';
      div.appendChild(bubble);
      this.messages.appendChild(div);
    }

    updateStreamingMessage(content) {
      const div = this.messages.querySelector('.streaming-msg');
      if (!div) return;
      const bubble = div.querySelector('.chat-bubble');
      bubble.innerHTML = formatContent(content) + '<span class="cursor">▊</span>';
    }

    finalizeStreamingMessage(content, mediaItems) {
      const div = this.messages.querySelector('.streaming-msg');
      if (!div) return this.appendMessage('assistant', content, Date.now(), mediaItems);
      const bubble = div.querySelector('.chat-bubble');
      bubble.classList.remove('streaming');
      bubble.innerHTML = '';
      const senderHeader = renderSenderHeader(normalizeSenderMeta({}, 'assistant', this), 'assistant');
      if (senderHeader) bubble.appendChild(senderHeader);
      const media = normalizeChatMedia(mediaItems || extractMedia({ content }, content));
      if (media.length) bubble.appendChild(renderChatMedia(media));
      if ((content || '').trim()) {
        const textDiv = document.createElement('div');
        textDiv.innerHTML = formatContent(content || '');
        bubble.appendChild(textDiv);
      }
      const time = document.createElement('span');
      time.className = 'chat-time';
      time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      bubble.appendChild(time);
      div.classList.remove('streaming-msg');
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
    scrollBottom() {
      if (this.scrollFrame) return;
      const scrollToEnd = () => {
        this.messages.scrollTop = this.messages.scrollHeight;
        const last = this.messages.lastElementChild;
        if (last) last.scrollIntoView({ block: 'end' });
      };
      this.scrollFrame = requestAnimationFrame(() => {
        this.scrollFrame = null;
        scrollToEnd();
        requestAnimationFrame(scrollToEnd);
        setTimeout(scrollToEnd, 80);
      });
    }

    stopHermesProgressTimers() {
      if (!this.hermesProgressTimers?.length) return;
      for (const timer of this.hermesProgressTimers) clearTimeout(timer);
      this.hermesProgressTimers = [];
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

    startHermesProgress(label) {
      this.stopHermesProgressTimers();
      const runId = 'hermes-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      this.currentRunId = runId;
      this.setStatus('Hermes stream active...', 'connecting');
      this.updateTypingIndicator(label + ' is running Hermes');
      this.startHermesLivePolling({ runId, label });
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
        this.setStatus('Hermes ready', 'connected');
        this.scrollBottom();
      } catch (e) {
        buttons.forEach(btn => btn.disabled = false);
        if (card) {
          card.classList.remove('responding');
          const status = card.querySelector('.chat-approval-status');
          if (status) status.textContent = 'error';
        }
        this.appendSystem('Hermes approval failed: ' + e.message);
        this.setStatus('Hermes error', 'disconnected');
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

    finalizeRunToolCards(runId) {
      for (const [key, wrap] of [...this.liveToolCards.entries()]) {
        if (!runId || wrap.dataset.runId === runId) {
          updateToolCallCard(wrap.querySelector('.chat-tool-call'), { status: 'done', result: 'Completed' });
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
      // Remove the move button — secondary panels are always tiled, not movable
      const existingMoveBtn = headerBtns.querySelector('.chat-move-btn');
      if (existingMoveBtn) existingMoveBtn.remove();
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
    if (chatMoveBtn) chatMoveBtn.classList.remove('active');

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
    windowInstance.applySelection(primaryOpt, { markExplicit: false, systemPrefix: 'Ready to chat with' });
  }

  function shouldUseSingleWindowMobileLayout() {
    return window.innerWidth <= 900;
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
      chatWindows.forEach(w => w.fetchContextUsage());
    }, 60000);
  }

  async function connectGateway() {
    if (ws) return;
    chatWindows.forEach(w => w.setStatus('Connecting...', 'connecting'));
    await loadGatewayInfo();
    if (ws) return;
    if (!GATEWAY_URL && !_chatWsPort) {
      chatWindows.forEach(w => w.setStatus('Gateway URL unavailable', 'disconnected'));
      return;
    }
    const gatewayUrl = getGatewayUrl();
    if (!gatewayUrl) {
      chatWindows.forEach(w => w.setStatus('Gateway URL unavailable', 'disconnected'));
      return;
    }
    try {
      ws = new WebSocket(gatewayUrl);
    } catch (err) {
      chatWindows.forEach(w => w.setStatus('Gateway URL invalid', 'disconnected'));
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
      chatWindows.forEach(w => w.setStatus(message, 'disconnected'));
      if (!gatewayAuthFailed && primaryWindow.root.classList.contains('open')) setTimeout(connectGateway, 3000);
    };
    socket.onerror = () => {
      if (ws === socket) chatWindows.forEach(w => w.setStatus('Connection error', 'disconnected'));
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
        connected = true;
        chatWindows.forEach(w => {
          w.setStatus('Connected ⚡', 'connected');
          if (w.isPrimary || w.root.classList.contains('open')) {
            w.fetchSessionInfo();
            w.loadHistory();
          }
        });
        startModelBarRefresh();
      } else {
        gatewayAuthFailed = true;
        gatewayAuthFailureMessage = `Auth failed: ${res.error?.message || 'unknown'}`;
        connected = false;
        chatWindows.forEach(w => w.setStatus(gatewayAuthFailureMessage, 'disconnected'));
        if (ws === socket) ws = null;
        try { socket.close(1008, 'auth failed'); } catch {}
      }
    };
    socket.send(JSON.stringify(msg));
  }

  function rpc(method, params) {
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
    if (event === 'chat') chatWindows.forEach(w => w.handleChatEvent(payload));
    if (event === 'agent') chatWindows.forEach(w => w.handleAgentEvent(payload));
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

  function resolveMessageSender(msg, win) {
    const message = msg?.message || msg || {};
    const role = message.role || msg?.role || '';
    const text = extractText(msg) || (typeof message.content === 'string' ? message.content : '') || '';
    const prov = message.provenance || msg?.provenance || {};
    const targetLabel = getWindowAgentLabel(win);

    if (role === 'assistant') return { label: targetLabel, kind: 'agent' };

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
        if (last && (!b.toolCallId || b.toolCallId === last.id)) {
          last.result = result;
          last.status = b.error ? 'error' : 'done';
        } else {
          tools.push({ status: b.error ? 'error' : 'done', name: b.name || 'tool result', result, id: b.toolCallId || b.id || '' });
        }
      }
    }
    return tools;
  }

  function normalizeHermesTools(items) {
    if (!Array.isArray(items)) return [];
    return items.filter(Boolean).map((item) => ({
      id: item.id || item.toolCallId || item.callId || '',
      status: item.status || (item.error ? 'error' : 'done'),
      name: item.name || item.toolName || item.tool_name || 'tool',
      arguments: coerceToolArgs(item.arguments || item.args || item.input || {}),
      result: item.result ?? item.output ?? item.content ?? '',
      error: item.error || ''
    }));
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
    if (opts.live || tool.status === 'running') details.open = true;
    details.dataset.toolName = tool.name || 'tool';

    const summary = document.createElement('summary');
    summary.className = 'chat-tool-summary';
    const icon = document.createElement('span');
    icon.className = 'chat-tool-icon';
    icon.textContent = tool.status === 'error' ? '⚠️' : tool.status === 'done' ? '✅' : '🔧';
    const title = document.createElement('span');
    title.className = 'chat-tool-title';
    title.textContent = formatToolLabel(tool.name, coerceToolArgs(tool.arguments));
    const state = document.createElement('span');
    state.className = 'chat-tool-state';
    state.textContent = tool.status === 'error' ? 'error' : tool.status === 'done' ? 'done' : 'running';
    summary.append(icon, title, state);
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
    card.classList.remove('running', 'done', 'error');
    card.classList.add(tool.status || 'done');
    const icon = card.querySelector('.chat-tool-icon');
    if (icon) icon.textContent = tool.status === 'error' ? '⚠️' : tool.status === 'done' ? '✅' : '🔧';
    const state = card.querySelector('.chat-tool-state');
    if (state) state.textContent = tool.status === 'error' ? 'error' : tool.status === 'done' ? 'done' : 'running';
    const title = card.querySelector('.chat-tool-title');
    if (title) title.textContent = formatToolLabel(tool.name, coerceToolArgs(tool.arguments));
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
    card.className = 'chat-approval-card ' + (status.includes('denied') ? 'denied' : status.includes('approved') ? 'approved' : 'pending');
    card.dataset.approvalId = approval.approval_id || approval.id || '';

    const header = document.createElement('div');
    header.className = 'chat-approval-header';
    const icon = document.createElement('span');
    icon.className = 'chat-approval-icon';
    icon.textContent = status.includes('denied') ? 'x' : status.includes('approved') ? 'OK' : '!';
    const title = document.createElement('span');
    title.className = 'chat-approval-title';
    title.textContent = approval.title || 'Hermes approval required';
    const state = document.createElement('span');
    state.className = 'chat-approval-status';
    const pendingCount = Number(approval.pending_count || approval.pendingCount || 0);
    state.textContent = status === 'pending' && pendingCount > 1 ? `${pendingCount} pending` : (status === 'pending' ? 'pending' : status);
    header.append(icon, title, state);

    const desc = document.createElement('div');
    desc.className = 'chat-approval-desc';
    desc.textContent = approval.description || 'Hermes needs user approval before it can continue.';

    const cmd = document.createElement('pre');
    cmd.className = 'chat-approval-command';
    cmd.textContent = approval.command || 'Approval-gated Hermes command';

    card.append(header, desc, cmd);
    if (status === 'pending') {
      const actions = document.createElement('div');
      actions.className = 'chat-approval-actions';
      const allow = document.createElement('button');
      allow.type = 'button';
      allow.className = 'chat-approval-btn primary';
      allow.textContent = 'Allow once';
      allow.title = 'Retry this Hermes turn with approval bypass for this invocation only';
      allow.addEventListener('click', () => windowInstance?.respondHermesApproval(approval, 'approve_once', card));
      const deny = document.createElement('button');
      deny.type = 'button';
      deny.className = 'chat-approval-btn';
      deny.textContent = 'Deny';
      deny.title = 'Do not retry this blocked Hermes command';
      deny.addEventListener('click', () => windowInstance?.respondHermesApproval(approval, 'deny', card));
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

  const _SAFE_TAGS = new Set(['p','br','strong','b','em','i','u','s','del','mark','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','hr','pre','code','span','a','img','table','thead','tbody','tr','th','td','sup','sub','small','details','summary']);
  const _SAFE_ATTRS = { 'a': ['href','title','target','rel'], 'img': ['src','alt','title','class','width','height'], 'code': ['class'], 'span': ['class'], 'pre': ['class'], 'td': ['align'], 'th': ['align'] };
  function _sanitizeHtml(html) {
    return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g, function(match, tag) {
      var lower = tag.toLowerCase();
      if (!_SAFE_TAGS.has(lower)) return '';
      var allowed = _SAFE_ATTRS[lower];
      if (!allowed) {
        if (match.charAt(1) === '/') return '</' + lower + '>';
        if (match.slice(-2) === '/>') return '<' + lower + ' />';
        return '<' + lower + '>';
      }
      var attrsStr = '';
      var attrRe = /\s([a-zA-Z\-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
      var m;
      while ((m = attrRe.exec(match)) !== null) {
        var attrName = m[1].toLowerCase();
        var attrVal = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]);
        if (allowed.indexOf(attrName) !== -1) {
          if ((attrName === 'href' || attrName === 'src') && /^\s*javascript\s*:/i.test(attrVal)) continue;
          attrsStr += ' ' + attrName + '="' + attrVal.replace(/"/g, '&quot;') + '"';
        }
      }
      if (match.charAt(1) === '/') return '</' + lower + '>';
      if (match.slice(-2) === '/>') return '<' + lower + attrsStr + ' />';
      return '<' + lower + attrsStr + '>';
    });
  }
  function formatContent(text) {
    if (!text) return '';
    const safeText = escHtml(text);
    let html;
    if (typeof marked !== 'undefined') {
      marked.setOptions({ breaks: true, gfm: true, sanitize: false });
      html = marked.parse(safeText);
    } else {
      html = safeText.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>');
    }
    html = _sanitizeHtml(html);
    html = html.replace(/<img ([^>]*)>/g, '<img $1 class="chat-image-thumb chat-image-clickable">');
    return html;
  }
  function escHtml(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

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

  chatWindows.forEach(w => w.loadAgentList());
  syncSecondaryChatControls();
  // Virtual World shows the chat dock in the HUD even before the panel is expanded.
  // Connect immediately so users don't see a stale "Offline" state while the UI is visible.
  gatewayInfoReady.then(() => connectGateway()).catch(() => {});

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
      windowInstance.applySelection(opt, { markExplicit: false, systemPrefix: 'Loaded' });
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
    if (shouldOpen && !ws) connectGateway();
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
    ws = null;
    connected = false;
    if (oldWs) {
      try { oldWs.close(1000, 'settings updated'); } catch {}
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

  window.addEventListener('vw:settings-saved', () => {
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
      setTimeout(applyQueryAgentAssignments, 400);
    }, 50);
  } else if (chatUrlParams.get('chatAgents')) {
    setTimeout(applyQueryAgentAssignments, 400);
  }

  // Gateway info is refreshed on connect and after settings saves so token changes
  // apply without a full browser reload.

  // --- MOVE / SNAP SYSTEM (primary window only) ---
  const chatPanel = primaryWindow.root;
  const chatMoveBtn = document.getElementById('chat-move');
  let _chatMoveMode = false;
  let _chatDragging = false;
  let _chatDragStartX = 0, _chatDragStartY = 0;
  let _chatOrigLeft = 0, _chatOrigTop = 0;
  let _chatSnapZoneL = null, _chatSnapZoneR = null;

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
  function _chatEnterMoveMode() {
    _chatMoveMode = true; chatMoveBtn.classList.add('active'); chatPanel.classList.add('move-active');
    // Exit move mode for all secondary windows
    [1, 2, 3].forEach((sn) => _secExitMoveMode(sn));
    var rect = chatPanel.getBoundingClientRect();
    chatPanel.classList.remove('snap-left', 'snap-right'); chatPanel.classList.add('floating');
    chatPanel.style.left = rect.left + 'px'; chatPanel.style.top = rect.top + 'px';
    chatPanel.style.right = 'auto'; chatPanel.style.bottom = 'auto'; chatPanel.style.width = rect.width + 'px'; chatPanel.style.height = rect.height + 'px';
  }
  function _chatExitMoveMode() {
    _chatMoveMode = false; _chatDragging = false;
    if (chatMoveBtn) chatMoveBtn.classList.remove('active');
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
    _chatMoveMode = false; _chatDragging = false;
    if (chatMoveBtn) chatMoveBtn.classList.remove('active');
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
  window.addEventListener('resize', () => { updateChatStackLayout(); _chatUpdateSnapPosition(); _positionExteriorTabs(); });
  if (chatMoveBtn) chatMoveBtn.addEventListener('click', (e) => { e.stopPropagation(); _chatMoveMode ? _chatExitMoveMode() : _chatEnterMoveMode(); });
  const chatHeader = chatPanel.querySelector('.chat-header');
  chatHeader.addEventListener('mousedown', (e) => {
    if (!_chatMoveMode) return;
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
    e.preventDefault(); _chatDragging = true; chatPanel.classList.add('dragging');
    _chatDragStartX = e.clientX; _chatDragStartY = e.clientY;
    var rect = chatPanel.getBoundingClientRect(); _chatOrigLeft = rect.left; _chatOrigTop = rect.top; _chatCreateSnapZones();
  });
  window.addEventListener('mousemove', (e) => {
    if (!_chatDragging) return;
    var dx = e.clientX - _chatDragStartX; var dy = e.clientY - _chatDragStartY;
    chatPanel.style.left = (_chatOrigLeft + dx) + 'px'; chatPanel.style.top = (_chatOrigTop + dy) + 'px';
    _tileSecondaryPanels();
    _positionExteriorTabs();
    var sbW = _getChatDockRightOffset(); var rightEdge = window.innerWidth - sbW;
    if (_chatSnapZoneL) _chatSnapZoneL.classList.toggle('active', e.clientX < 80);
    if (_chatSnapZoneR) { _chatSnapZoneR.style.right = sbW + 'px'; _chatSnapZoneR.classList.toggle('active', e.clientX > rightEdge - 80); }
  });
  window.addEventListener('mouseup', (e) => {
    if (!_chatDragging) return;
    _chatDragging = false; chatPanel.classList.remove('dragging');
    var sbW = _getChatDockRightOffset(); var rightEdge = window.innerWidth - sbW;
    if (e.clientX < 80) _chatSnapTo('left'); else if (e.clientX > rightEdge - 80) _chatSnapTo('right');
    _chatRemoveSnapZones();
    _tileSecondaryPanels();
    _positionExteriorTabs();
    _resolveOverlaps(chatPanel);
  });

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
