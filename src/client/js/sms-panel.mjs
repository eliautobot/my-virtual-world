import { createBrowserWindowController } from './browser-window-controller.mjs?v=20260810-floating-window-r1';

const ACKNOWLEDGED_KEY = 'vw-sms-acknowledged-threads';
const INBOX_COLLAPSED_KEY = 'vw-sms-inbox-collapsed';
const MOBILE_QUERY = '(max-width: 640px)';

function byId(id) {
  return document.getElementById(id);
}

function normalizePhone(phone) {
  let value = String(phone || '').trim().replace(/[\s().-]+/g, '');
  if (value.startsWith('00')) value = `+${value.slice(2)}`;
  if (value.startsWith('+') && /^\+\d+$/.test(value)) return value;
  if (/^\d{10}$/.test(value)) return `+1${value}`;
  if (/^1\d{10}$/.test(value)) return `+${value}`;
  return value;
}

function formatPhone(phone) {
  const value = normalizePhone(phone);
  const match = value.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return match ? `+1 (${match[1]}) ${match[2]}-${match[3]}` : value;
}

function formatTime(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function loadStoredMap(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    const error = new Error(body.error?.message || body.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function panelViewportBounds() {
  const styles = getComputedStyle(document.documentElement);
  const topBar = Number.parseFloat(styles.getPropertyValue('--topbar-height')) || 0;
  const banner = Number.parseFloat(styles.getPropertyValue('--demo-banner-height')) || 0;
  return { left: 0, top: topBar + banner, right: innerWidth, bottom: innerHeight };
}

function createSmsPanel() {
  const panel = byId('smsPanel');
  const toolbarButton = byId('btn-smsPanel');
  if (!panel || !toolbarButton) return null;

  const elements = {
    status: byId('smsPanelStatus'),
    owner: byId('smsOwnerBadge'),
    count: byId('smsThreadCount'),
    list: byId('smsThreadList'),
    contact: byId('smsContactSelect'),
    newThread: byId('smsNewThread'),
    newThreadRow: byId('smsNewThreadRow'),
    to: byId('smsTo'),
    openThread: byId('smsOpenThread'),
    collapse: byId('smsInboxCollapse'),
    expand: byId('smsInboxExpand'),
    title: byId('smsThreadTitle'),
    subtitle: byId('smsThreadSubtitle'),
    control: byId('smsControlToggle'),
    controlLabel: byId('smsControlLabel'),
    empty: byId('smsEmptyState'),
    messages: byId('smsMessages'),
    body: byId('smsBody'),
    send: byId('smsSend'),
    refresh: byId('smsRefresh'),
    close: byId('smsPanelClose'),
  };

  const windowController = createBrowserWindowController({
    panel,
    dragHandle: panel.querySelector('.sms-panel-header'),
    maximizeButton: byId('smsPanelMaximize'),
    resizeHandles: panel.querySelectorAll('[data-resize]'),
    getBounds: panelViewportBounds,
    minimumSize: { width: 620, height: 420 },
    isCompactLayout: () => matchMedia(MOBILE_QUERY).matches,
    windowLabel: 'SMS',
    bodyInteractionClass: 'sms-window-interacting',
  });

  let smsStatus = null;
  let threads = [];
  let contacts = [];
  let selectedPhone = '';
  let selectedThread = null;
  let pollingTimer = 0;
  let acknowledged = loadStoredMap(ACKNOWLEDGED_KEY);

  function isOpen() {
    return panel.style.display !== 'none';
  }

  function setStatus(message, kind = '') {
    elements.status.textContent = message;
    elements.status.classList.toggle('error', kind === 'error');
  }

  function renderOwner(owner) {
    elements.owner.textContent = owner?.id
      ? `${owner.emoji || '🤖'} SMS agent: ${owner.name || owner.id} · ${owner.status || 'offline'}`
      : '🤖 SMS agent not assigned · assign one from the Agent edit menu or Settings';
  }

  function isWaiting(thread) {
    if ((thread?.lastType || '') !== 'inbound') return false;
    const seen = Date.parse(acknowledged[normalizePhone(thread.phone)] || '') || 0;
    const received = Date.parse(thread.lastTimestamp || '') || 0;
    return received > seen;
  }

  function markSeen(thread) {
    if (!thread || (thread.lastType || '') !== 'inbound') return;
    acknowledged[normalizePhone(thread.phone)] = thread.lastTimestamp || new Date().toISOString();
    try { localStorage.setItem(ACKNOWLEDGED_KEY, JSON.stringify(acknowledged)); } catch { /* optional */ }
  }

  function renderThreadList() {
    elements.list.replaceChildren();
    const waiting = threads.filter(isWaiting).length;
    elements.count.textContent = String(threads.length);
    elements.count.classList.toggle('attention', waiting > 0);
    toolbarButton.classList.toggle('sms-toggle-alert', waiting > 0);
    if (waiting) toolbarButton.dataset.alertCount = waiting > 9 ? '9+' : String(waiting);
    else delete toolbarButton.dataset.alertCount;

    if (!threads.length) {
      const empty = document.createElement('div');
      empty.className = 'sms-empty-state';
      empty.textContent = smsStatus?.hasCredentials ? 'No SMS conversations yet.' : 'Configure Twilio in Settings to sync conversations.';
      elements.list.append(empty);
      return;
    }

    for (const thread of threads) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `sms-thread-row${normalizePhone(thread.phone) === selectedPhone ? ' active' : ''}${isWaiting(thread) ? ' needs-attention' : ''}`;
      const top = document.createElement('div');
      top.className = 'sms-thread-top';
      const name = document.createElement('span');
      name.className = 'sms-thread-name';
      name.textContent = thread.displayName || thread.name || formatPhone(thread.phone);
      const time = document.createElement('span');
      time.className = 'sms-thread-time';
      time.textContent = formatTime(thread.lastTimestamp);
      top.append(name, time);

      const phone = document.createElement('div');
      phone.className = 'sms-thread-phone';
      phone.textContent = formatPhone(thread.phone);
      const preview = document.createElement('div');
      preview.className = 'sms-thread-preview';
      preview.textContent = thread.lastMessage || 'No messages yet';
      const badges = document.createElement('div');
      badges.className = 'sms-thread-badges';
      const mode = document.createElement('span');
      mode.className = `sms-thread-badge ${thread.activeMode === 'user' ? 'user' : 'agent'}`;
      mode.textContent = `${thread.activeMode === 'user' ? 'User' : 'Agent'} control`;
      const count = document.createElement('span');
      count.className = 'sms-thread-badge';
      count.textContent = `${thread.messageCount || thread.count || 0} msg`;
      badges.append(mode, count);
      if (isWaiting(thread)) {
        const attention = document.createElement('span');
        attention.className = 'sms-thread-badge attention';
        attention.textContent = 'New reply';
        badges.prepend(attention);
      }
      row.append(top, phone, preview, badges);
      row.addEventListener('click', () => selectThread(thread.phone));
      elements.list.append(row);
    }
  }

  function renderContacts() {
    const current = elements.contact.value;
    elements.contact.replaceChildren(new Option('Select contact…', ''));
    for (const contact of contacts) {
      elements.contact.add(new Option(`${contact.name && contact.name !== 'Unknown' ? contact.name : formatPhone(contact.phone)} · ${formatPhone(contact.phone)}`, contact.phone));
    }
    if ([...elements.contact.options].some(option => option.value === (selectedPhone || current))) {
      elements.contact.value = selectedPhone || current;
    }
  }

  function setControl(mode, enabled = true) {
    const user = mode === 'user';
    elements.control.checked = user;
    elements.control.disabled = !enabled;
    elements.controlLabel.textContent = user ? 'User' : 'Agent';
    elements.controlLabel.style.color = user ? '#ffe36b' : '#8fdcff';
    elements.body.disabled = !enabled || !user;
    elements.send.disabled = !enabled || !user;
    elements.body.placeholder = !enabled
      ? 'Select a conversation first…'
      : user
        ? 'Type a message as you…'
        : 'Agent owns this conversation. Switch to User control to reply manually…';
  }

  function showInboxPlaceholder() {
    selectedThread = null;
    elements.title.textContent = 'SMS Inbox';
    const waiting = threads.filter(isWaiting).length;
    elements.subtitle.textContent = waiting ? `${waiting} conversation${waiting === 1 ? '' : 's'} with a new reply.` : `${threads.length} conversation${threads.length === 1 ? '' : 's'} synced.`;
    elements.messages.replaceChildren();
    elements.messages.style.display = 'none';
    elements.empty.style.display = 'grid';
    elements.empty.textContent = 'Select a conversation from the Inbox, or start a new one.';
    setControl('agent', false);
  }

  function renderMessages(thread, messages) {
    selectedThread = thread;
    elements.title.textContent = thread.displayName || (thread.name !== 'Unknown' ? thread.name : '') || formatPhone(thread.phone);
    elements.subtitle.textContent = formatPhone(thread.phone);
    elements.messages.replaceChildren();
    elements.empty.style.display = messages.length ? 'none' : 'grid';
    elements.empty.textContent = 'No messages in this conversation yet.';
    elements.messages.style.display = messages.length ? 'flex' : 'none';
    for (const message of messages) {
      const bubble = document.createElement('div');
      const type = message.type === 'intervention' ? 'intervention' : message.direction === 'outbound' ? 'outbound' : 'inbound';
      bubble.className = `sms-message ${type}`;
      const meta = document.createElement('div');
      meta.className = 'sms-message-meta';
      meta.textContent = `${type === 'inbound' ? (thread.name && thread.name !== 'Unknown' ? thread.name : formatPhone(thread.phone)) : type === 'intervention' ? 'You' : (smsStatus?.ownerAgent?.name || 'Agent')} · ${formatTime(message.timestamp)}`;
      const body = document.createElement('div');
      body.className = 'sms-message-body';
      body.textContent = message.body || (message.numMedia ? `Media message (${message.numMedia})` : '');
      bubble.append(meta, body);
      elements.messages.append(bubble);
    }
    setControl(thread.activeMode || 'agent', true);
    requestAnimationFrame(() => { elements.messages.scrollTop = elements.messages.scrollHeight; });
  }

  async function selectThread(phone) {
    selectedPhone = normalizePhone(phone);
    const summary = threads.find(item => normalizePhone(item.phone) === selectedPhone);
    markSeen(summary);
    renderThreadList();
    if (matchMedia(MOBILE_QUERY).matches) panel.classList.add('sms-mobile-thread');
    try {
      const data = await fetchJson(`/sms-thread?phone=${encodeURIComponent(selectedPhone)}&limit=250`);
      const thread = { ...(summary || {}), ...(data.thread || {}), phone: selectedPhone };
      const index = threads.findIndex(item => normalizePhone(item.phone) === selectedPhone);
      if (index >= 0) threads[index] = { ...threads[index], ...thread };
      else threads.unshift(thread);
      renderMessages(thread, data.messages || []);
      renderThreadList();
    } catch (error) {
      setStatus(error.message, 'error');
    }
  }

  async function refresh({ forceSync = false, quiet = false } = {}) {
    if (!quiet) setStatus('Refreshing SMS inbox…');
    smsStatus = await fetchJson('/sms-status');
    renderOwner(smsStatus.ownerAgent);
    if (smsStatus.locked || !smsStatus.enabled) {
      setStatus(smsStatus.locked ? 'SMS / Twilio is locked until activation.' : 'SMS is disabled. Enable it in Settings.', 'error');
      threads = [];
      contacts = [];
      renderThreadList();
      showInboxPlaceholder();
      return;
    }
    let syncWarning = '';
    if (smsStatus.hasCredentials && smsStatus.syncHistory !== false) {
      try {
        await fetchJson('/sms-sync', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: forceSync }),
        });
      } catch (error) {
        syncWarning = error.message;
      }
    }
    const [threadData, contactData] = await Promise.all([fetchJson('/sms-threads'), fetchJson('/sms-contacts')]);
    threads = threadData.threads || [];
    contacts = contactData.contacts || [];
    renderOwner(threadData.ownerAgent || smsStatus.ownerAgent);
    renderContacts();
    renderThreadList();
    if (selectedPhone && threads.some(item => normalizePhone(item.phone) === selectedPhone)) await selectThread(selectedPhone);
    else showInboxPlaceholder();
    if (syncWarning) setStatus(`Local messages loaded. Twilio sync: ${syncWarning}`, 'error');
    else setStatus(smsStatus.hasCredentials ? 'Inbox synced with Twilio.' : 'Twilio credentials are not configured.');
  }

  async function open() {
    panel.style.display = 'flex';
    panel.classList.remove('sms-mobile-thread');
    requestAnimationFrame(() => windowController.constrain());
    try { await refresh(); } catch (error) { setStatus(error.message, 'error'); }
    if (!pollingTimer) {
      pollingTimer = window.setInterval(() => {
        if (isOpen()) refresh({ quiet: true }).catch(error => setStatus(error.message, 'error'));
      }, 15000);
    }
  }

  function close() {
    panel.style.display = 'none';
    panel.classList.remove('sms-mobile-thread');
    windowController.setMaximized(false);
  }

  async function openNewThread() {
    const phone = normalizePhone(elements.to.value);
    if (!phone) return setStatus('Enter a phone number to start a conversation.', 'error');
    await fetchJson('/sms-thread-mode', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, activeMode: 'user' }),
    });
    elements.newThreadRow.hidden = true;
    selectedPhone = phone;
    if (!threads.some(item => normalizePhone(item.phone) === phone)) {
      threads.unshift({ phone, name: 'Unknown', displayName: phone, activeMode: 'user', messageCount: 0 });
    }
    await selectThread(phone);
  }

  async function changeControl() {
    if (!selectedPhone || !selectedThread) return;
    const next = elements.control.checked ? 'user' : 'agent';
    elements.control.disabled = true;
    try {
      await fetchJson('/sms-thread-mode', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: selectedPhone, activeMode: next }),
      });
      selectedThread.activeMode = next;
      const summary = threads.find(item => normalizePhone(item.phone) === selectedPhone);
      if (summary) summary.activeMode = next;
      setControl(next, true);
      renderThreadList();
      setStatus(`${next === 'user' ? 'You now control' : `${smsStatus?.ownerAgent?.name || 'The assigned agent'} now controls`} this conversation.`);
    } catch (error) {
      setControl(selectedThread.activeMode || 'agent', true);
      setStatus(error.message, 'error');
    }
  }

  async function send() {
    const body = elements.body.value.trim();
    if (!selectedPhone || !body || selectedThread?.activeMode !== 'user') return;
    elements.send.disabled = true;
    elements.send.textContent = 'Sending…';
    try {
      await fetchJson('/sms-send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: selectedPhone, body, name: selectedThread.name || '', sender: 'user' }),
      });
      elements.body.value = '';
      await refresh({ quiet: true });
      setStatus('Message sent.');
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      elements.send.textContent = 'Send';
      setControl(selectedThread?.activeMode || 'agent', Boolean(selectedThread));
    }
  }

  function setInboxCollapsed(collapsed) {
    panel.classList.toggle('sms-inbox-collapsed', Boolean(collapsed));
    try { localStorage.setItem(INBOX_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* optional */ }
    requestAnimationFrame(() => windowController.constrain());
  }

  toolbarButton.addEventListener('click', open);
  byId('btn-openSmsPanel')?.addEventListener('click', open);
  elements.close.addEventListener('click', close);
  elements.refresh.addEventListener('click', () => refresh({ forceSync: true }).catch(error => setStatus(error.message, 'error')));
  elements.newThread.addEventListener('click', () => {
    elements.newThreadRow.hidden = !elements.newThreadRow.hidden;
    if (!elements.newThreadRow.hidden) elements.to.focus();
  });
  elements.openThread.addEventListener('click', () => openNewThread().catch(error => setStatus(error.message, 'error')));
  elements.to.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); openNewThread().catch(error => setStatus(error.message, 'error')); }
  });
  elements.contact.addEventListener('change', () => { if (elements.contact.value) selectThread(elements.contact.value); });
  elements.control.addEventListener('change', changeControl);
  elements.send.addEventListener('click', send);
  elements.body.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); }
  });
  elements.collapse.addEventListener('click', () => setInboxCollapsed(true));
  elements.expand.addEventListener('click', () => {
    if (matchMedia(MOBILE_QUERY).matches) {
      panel.classList.remove('sms-mobile-thread');
      showInboxPlaceholder();
    } else setInboxCollapsed(false);
  });
  window.addEventListener('vw:settings-saved', () => { if (isOpen()) refresh({ forceSync: true }).catch(() => {}); });
  window.addEventListener('vw:sms-owner-changed', () => { if (isOpen()) refresh({ quiet: true }).catch(() => {}); });
  setInboxCollapsed(localStorage.getItem(INBOX_COLLAPSED_KEY) === '1' && !matchMedia(MOBILE_QUERY).matches);

  window.openSmsPanel = open;
  return { open, close, refresh, destroy: () => windowController.destroy() };
}

function initialize() {
  if (!window.__vwSmsPanel) window.__vwSmsPanel = createSmsPanel();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
else initialize();
