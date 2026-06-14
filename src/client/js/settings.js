(function () {
  let vwConfig = null;
  let originalSaveSettings = null;
  let liveModeAgents = [];
  let liveModeLoopStatus = null;
  const liveModeAgentEdits = new Map();

  const $ = (id) => document.getElementById(id);
  const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
  const setStatus = (id, text, tone = 'info') => {
    const el = $(id);
    if (!el) return;
    el.className = `settings-inline-status ${tone}`;
    el.textContent = text;
  };
  const checked = (id) => $(id)?.checked === true;
  const value = (id) => ($(id)?.value || '').trim();
  const DEMO_MESSAGE = 'DEMO: 3 agents max, some features are locked. Get a License Key to activate all features.';

  function isTrialLicense(lic) {
    return lic?.trial !== false && !lic?.licensed;
  }

  function setLocked(ids, locked) {
    ids.forEach(id => {
      const el = $(id);
      if (!el) return;
      el.disabled = locked;
      el.classList.toggle('feature-locked-control', locked);
      if (locked) el.setAttribute('aria-disabled', 'true');
      else el.removeAttribute('aria-disabled');
    });
  }

  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function switchTab(name) {
    document.querySelectorAll('.settings-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.settingsTab === name));
    document.querySelectorAll('.settings-pane').forEach(pane => pane.classList.toggle('visible', pane.dataset.settingsPane === name));
  }

  function updateLicenseUi(config) {
    const lic = config?.license || {};
    const trial = isTrialLicense(lic);
    window.__VWLicense = lic;
    window.__VWConfig = config;
    document.body.classList.toggle('vw-demo-mode', trial);
    document.body.classList.toggle('vw-demo-locked', trial);
    const chip = $('licenseStatusChip');
    if (chip) {
      chip.hidden = trial;
      chip.textContent = lic.tierName || 'Licensed';
      chip.classList.toggle('licensed', !trial);
    }
    const watermark = $('trialWatermark');
    if (watermark) {
      watermark.hidden = !(trial && lic.limits?.watermark);
      watermark.textContent = DEMO_MESSAGE;
    }
    const limits = lic.limits || {};
    const summary = $('licenseSummary');
    if (summary) {
      summary.innerHTML = trial
        ? `<strong>Demo mode</strong><span>${DEMO_MESSAGE} Editing, Agent Browser, SMS / Twilio, and Agent Live Mode unlock after activation.</span>`
        : `<strong>${lic.tierName || 'Licensed'}</strong><span>All Virtual World features are unlocked${lic.activatedAt ? ` since ${lic.activatedAt}` : ''}.</span>`;
      summary.classList.toggle('locked', trial);
    }
    const lockNotice = $('featureLockNotice');
    if (lockNotice) {
      lockNotice.innerHTML = trial
        ? '<strong>Demo locks active</strong><span>Editing, Agent Browser, SMS / Twilio, and Agent Live Mode require an active license key.</span>'
        : '<strong>Full access</strong><span>Paid integrations are available when configured.</span>';
      lockNotice.classList.toggle('locked', trial);
    }
    setLocked([
      'setting-featureBrowser',
      'setting-featureSms',
      'setting-featureAgentLiveMode',
      'setting-browserCdpUrl',
      'setting-browserViewerUrl',
      'btn-testBrowser',
      'btn-openBrowserPanel',
      'setting-smsOwnerAgent',
      'setting-twilioSid',
      'setting-twilioToken',
      'setting-twilioFrom',
      'setting-smsPublicMediaUrl',
      'btn-testSms',
      'btn-openSmsPanel',
      'smsTo',
      'smsBody',
      'smsSend',
    ], trial);
    ['setting-featureBrowser', 'setting-featureSms', 'setting-featureAgentLiveMode'].forEach(id => {
      const el = $(id);
      if (el && trial) el.checked = false;
    });
  }

  async function populateAgents(selectedId = '') {
    const select = $('setting-smsOwnerAgent');
    if (!select) return;
    select.innerHTML = '<option value="">Select an agent...</option>';
    try {
      const data = await fetchJson('/agents-list');
      (data.agents || []).forEach(agent => {
        const opt = document.createElement('option');
        opt.value = agent.agentId || agent.key;
        opt.textContent = `${agent.emoji || ''} ${agent.name || agent.key}`.trim();
        if (opt.value === selectedId) opt.selected = true;
        select.appendChild(opt);
      });
    } catch {
      // Agent list is optional for settings.
    }
  }

  function agentLiveModeId(agent) {
    return String(agent?.id || agent?.statusKey || agent?.agentId || '').trim();
  }

  function setLiveModeControlsDisabled(disabled) {
    $('btn-saveLiveAgents')?.toggleAttribute('disabled', disabled);
    $('btn-refreshLiveLoop')?.toggleAttribute('disabled', disabled);
    $('btn-pauseLiveLoop')?.toggleAttribute('disabled', disabled);
    $('btn-resumeLiveLoop')?.toggleAttribute('disabled', disabled);
    $('btn-clearLiveClient')?.toggleAttribute('disabled', disabled);
    $('setting-liveLoopPauseSec')?.toggleAttribute('disabled', disabled);
    document.querySelectorAll('[data-live-agent-toggle]').forEach(input => {
      input.disabled = disabled;
    });
  }

  function renderLiveModeLoopStatus() {
    const card = $('liveModeLoopStatus');
    if (!card) return;
    const trial = isTrialLicense(vwConfig?.license || {});
    const globalEnabled = checked('setting-featureAgentLiveMode');
    if (trial || !globalEnabled) {
      card.classList.add('locked');
      card.innerHTML = trial
        ? '<strong>Loop locked</strong><span>Activate a License Key to manage the Live Mode loop.</span>'
        : '<strong>Loop off</strong><span>Turn on Agent Live Mode in Features to manage loop controls.</span>';
      return;
    }

    const runtime = liveModeLoopStatus?.runtime || {};
    const state = liveModeLoopStatus?.state || {};
    const pause = runtime.pause || {};
    const worldClient = runtime.worldClient || {};
    const client = worldClient.client || {};
    const paused = pause.active === true;
    const clientLabel = worldClient.active
      ? `Client active (${Math.round(Number(worldClient.ageSec) || 0)}s)`
      : 'Client inactive';
    const sessionLabel = client.sessionId
      ? `Session ${String(client.sessionId).slice(0, 28)}`
      : (client.lastSeenAt ? 'Last client session unknown' : 'No client session recorded');
    const clientMeta = [
      client.version || worldClient.requiredClientVersion,
      client.visibility,
      client.page,
    ].filter(Boolean).join(' · ');
    const diagnostic = worldClient.diagnostic || (worldClient.active
      ? 'A current 3D tab can let the loop create visible actions.'
      : 'The loop waits for a fresh 3D tab before creating visible actions.');
    const details = [
      `<span>${escapeHtml(sessionLabel)}</span>`,
      clientMeta ? `<span>${escapeHtml(clientMeta)}</span>` : '',
      diagnostic ? `<span>${escapeHtml(diagnostic)}</span>` : '',
    ].filter(Boolean).join('');
    card.classList.toggle('locked', paused || state.enabled === false);
    card.innerHTML = paused
      ? `<strong>Loop paused · ${Math.max(0, Number(pause.remainingSec) || 0)}s</strong><span>${escapeHtml(clientLabel)}</span>${details}`
      : `<strong>${state.enabled === false ? 'Loop disabled' : 'Loop ready'}</strong><span>${escapeHtml(clientLabel)}</span>${details}`;
  }

  function renderLiveModeAgents() {
    const list = $('liveModeAgentList');
    const summary = $('liveModeSummary');
    if (!list || !summary) return;
    const trial = isTrialLicense(vwConfig?.license || {});
    const globalEnabled = checked('setting-featureAgentLiveMode');
    const enabledCount = liveModeAgents.filter(agent => {
      const id = agentLiveModeId(agent);
      return liveModeAgentEdits.has(id) ? liveModeAgentEdits.get(id) : agent.agentLiveModeEnabled === true;
    }).length;
    summary.classList.toggle('locked', trial || !globalEnabled);
    summary.innerHTML = trial
      ? '<strong>Agent Live Mode locked</strong><span>Activate a License Key to manage live agents.</span>'
      : globalEnabled
        ? `<strong>${enabledCount} live agent${enabledCount === 1 ? '' : 's'} selected</strong><span>Green pulsing head dot = Live Mode on. Red head dot = Live Mode off.</span>`
        : '<strong>Agent Live Mode off</strong><span>Turn on Agent Live Mode in Features before applying agent selection.</span>';

    list.innerHTML = '';
    if (!liveModeAgents.length) {
      const empty = document.createElement('div');
      empty.className = 'settings-live-agent-empty';
      empty.textContent = 'No agents found.';
      list.appendChild(empty);
      setLiveModeControlsDisabled(true);
      return;
    }

    liveModeAgents.forEach(agent => {
      const id = agentLiveModeId(agent);
      const enabled = liveModeAgentEdits.has(id) ? liveModeAgentEdits.get(id) : agent.agentLiveModeEnabled === true;
      const row = document.createElement('label');
      row.className = `settings-live-agent-row ${enabled ? 'live' : 'off'}`;
      row.dataset.agentId = id;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = enabled;
      checkbox.disabled = trial || !globalEnabled || !id;
      checkbox.dataset.liveAgentToggle = id;
      checkbox.addEventListener('change', () => {
        liveModeAgentEdits.set(id, checkbox.checked);
        renderLiveModeAgents();
        setStatus('liveModeAgentStatus', 'Selection changed. Apply to save.', 'info');
      });

      const dot = document.createElement('span');
      dot.className = `settings-live-agent-dot ${enabled ? 'live' : 'off'}`;
      dot.setAttribute('aria-hidden', 'true');

      const name = document.createElement('span');
      name.className = 'settings-live-agent-name';
      name.textContent = `${agent.emoji || '🤖'} ${agent.name || id || 'Agent'}`;

      const meta = document.createElement('span');
      meta.className = 'settings-live-agent-meta';
      meta.textContent = [agent.providerKind || agent.provider || 'agent', agent.status || 'offline'].filter(Boolean).join(' · ');

      row.append(checkbox, dot, name, meta);
      list.appendChild(row);
    });

    setLiveModeControlsDisabled(trial || !globalEnabled);
    renderLiveModeLoopStatus();
  }

  async function refreshLiveModeLoopStatus({ quiet = false } = {}) {
    try {
      liveModeLoopStatus = await fetchJson('/api/agent-live-loop');
      renderLiveModeLoopStatus();
      if (!quiet) setStatus('liveModeLoopActionStatus', 'Loop status refreshed.', 'success');
      return liveModeLoopStatus;
    } catch (err) {
      setStatus('liveModeLoopActionStatus', err.message || 'Could not load loop status.', 'warn');
      throw err;
    }
  }

  async function updateLiveModeLoop(payload, successText) {
    if (isTrialLicense(vwConfig?.license || {})) {
      setStatus('liveModeLoopActionStatus', 'Agent Live Mode is locked until activation.', 'warn');
      return null;
    }
    if (!checked('setting-featureAgentLiveMode')) {
      setStatus('liveModeLoopActionStatus', 'Turn on Agent Live Mode in Features first.', 'warn');
      return null;
    }
    const result = await fetchJson('/api/agent-live-loop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    liveModeLoopStatus = {
      ok: result.ok,
      state: result.state,
      runtime: result.runtime,
    };
    renderLiveModeLoopStatus();
    setStatus('liveModeLoopActionStatus', successText, 'success');
    return result;
  }

  async function pauseLiveModeLoop() {
    const input = $('setting-liveLoopPauseSec');
    const raw = Number(input?.value || 600);
    const pauseSec = Math.min(3600, Math.max(30, Number.isFinite(raw) ? Math.round(raw) : 600));
    if (input) input.value = String(pauseSec);
    await updateLiveModeLoop({
      pauseSec,
      pauseReason: 'operator-ui',
      pausedBy: 'settings-ui',
      clearWorldClientActivity: true,
    }, `Paused loop for ${pauseSec} seconds.`);
  }

  async function resumeLiveModeLoop() {
    await updateLiveModeLoop({ clearPause: true }, 'Loop resumed.');
  }

  async function clearLiveModeClientActivity() {
    await updateLiveModeLoop({ clearWorldClientActivity: true }, 'Client marker cleared.');
  }

  async function refreshLiveModeAgents() {
    const list = $('liveModeAgentList');
    if (list) list.innerHTML = '<div class="settings-live-agent-empty">Loading...</div>';
    try {
      const agents = await fetchJson('/api/agents');
      liveModeAgents = Array.isArray(agents) ? agents : [];
      liveModeAgentEdits.clear();
      renderLiveModeAgents();
      setStatus('liveModeAgentStatus', `${liveModeAgents.length} agents loaded.`, liveModeAgents.length ? 'success' : 'warn');
      window.dispatchEvent(new CustomEvent('vw:live-mode-agents-updated', { detail: { agents: liveModeAgents } }));
    } catch (err) {
      liveModeAgents = [];
      renderLiveModeAgents();
      setStatus('liveModeAgentStatus', err.message || 'Could not load agents.', 'warn');
    }
  }

  function populateForm(config) {
    vwConfig = config;
    const world = config.world || {};
    const openclaw = config.openclaw || {};
    const hermes = config.hermes || {};
    const features = config.features || {};
    const browser = config.browser || {};
    const sms = config.sms || {};
    const debug = config.debug || {};
    if ($('setting-worldName')) $('setting-worldName').value = world.name || 'My Virtual World';
    if ($('setting-showGrid')) $('setting-showGrid').checked = world.showGrid !== false;
    if ($('setting-showMinimap')) $('setting-showMinimap').checked = world.showMinimap !== false;
    if ($('setting-showCoords')) $('setting-showCoords').checked = world.showCoords !== false;
    if ($('setting-enableDayNightCycle')) $('setting-enableDayNightCycle').checked = world.dayNightCycleEnabled !== false;
    if ($('setting-enableWeather')) $('setting-enableWeather').checked = world.weatherEnabled !== false;
    if ($('setting-openclawPath')) $('setting-openclawPath').value = openclaw.homePath || '';
    if ($('setting-gatewayUrl')) $('setting-gatewayUrl').value = openclaw.gatewayUrl || '';
    if ($('setting-gatewayToken')) $('setting-gatewayToken').placeholder = openclaw.gatewayTokenConfigured ? 'Configured - leave blank to keep' : 'Gateway token';
    if ($('setting-hermesEnabled')) $('setting-hermesEnabled').checked = hermes.enabled !== false;
    if ($('setting-hermesHome')) $('setting-hermesHome').value = hermes.homePath || '';
    if ($('setting-hermesBin')) $('setting-hermesBin').value = hermes.binary || '';
    if ($('setting-hermesApiUrl')) $('setting-hermesApiUrl').value = hermes.apiUrl || '';
    if ($('setting-hermesApiKey')) $('setting-hermesApiKey').placeholder = hermes.apiKeyConfigured ? 'Configured - leave blank to keep' : 'Hermes API key';
    const trial = isTrialLicense(config.license || {});
    if ($('setting-featureBrowser')) $('setting-featureBrowser').checked = !trial && !!features.agentBrowser;
    if ($('setting-featureSms')) $('setting-featureSms').checked = !trial && !!features.sms;
    if ($('setting-featureAgentLiveMode')) $('setting-featureAgentLiveMode').checked = !trial && !!features.agentLiveMode;
    if ($('setting-featureDebugTools')) $('setting-featureDebugTools').checked = features.debugTools !== false;
    if ($('setting-browserCdpUrl')) $('setting-browserCdpUrl').value = browser.cdpUrl || '';
    if ($('setting-browserViewerUrl')) $('setting-browserViewerUrl').value = browser.viewerUrl || '';
    if ($('setting-twilioSid')) $('setting-twilioSid').value = sms.twilioAccountSid || '';
    if ($('setting-twilioFrom')) $('setting-twilioFrom').value = sms.fromNumber || '';
    if ($('setting-twilioToken')) $('setting-twilioToken').placeholder = sms.authTokenConfigured ? 'Configured - leave blank to keep' : 'Twilio auth token';
    if ($('setting-smsPublicMediaUrl')) $('setting-smsPublicMediaUrl').value = sms.publicMediaBaseUrl || '';
    if ($('setting-movementDebugOverlays')) $('setting-movementDebugOverlays').checked = debug.movementDebugOverlays === true;
    if ($('setting-objectActionPointDebug')) $('setting-objectActionPointDebug').checked = debug.objectActionPointDebug === true;
    updateLicenseUi(config);
    populateAgents(sms.ownerAgentId || '');
    refreshLiveModeAgents().catch(() => {});
    refreshLiveModeLoopStatus({ quiet: true }).catch(() => {});
  }

  function buildSettingsPayload() {
    const trial = isTrialLicense(vwConfig?.license || {});
    const payload = {
      _setupComplete: true,
      world: {
        name: value('setting-worldName') || 'My Virtual World',
        showGrid: checked('setting-showGrid'),
        showMinimap: checked('setting-showMinimap'),
        showCoords: checked('setting-showCoords'),
        dayNightCycleEnabled: checked('setting-enableDayNightCycle'),
        weatherEnabled: checked('setting-enableWeather'),
      },
      openclaw: {
        homePath: value('setting-openclawPath'),
        gatewayUrl: value('setting-gatewayUrl'),
      },
      hermes: {
        enabled: checked('setting-hermesEnabled'),
        homePath: value('setting-hermesHome'),
        binary: value('setting-hermesBin'),
        apiUrl: value('setting-hermesApiUrl'),
        preferApi: true,
      },
      features: {
        agentBrowser: !trial && checked('setting-featureBrowser'),
        sms: !trial && checked('setting-featureSms'),
        agentLiveMode: !trial && checked('setting-featureAgentLiveMode'),
        debugTools: checked('setting-featureDebugTools'),
        weather: checked('setting-enableWeather'),
      },
      browser: {
        cdpUrl: value('setting-browserCdpUrl'),
        viewerUrl: value('setting-browserViewerUrl'),
      },
      sms: {
        ownerAgentId: value('setting-smsOwnerAgent'),
        twilioAccountSid: value('setting-twilioSid'),
        fromNumber: value('setting-twilioFrom'),
        publicMediaBaseUrl: value('setting-smsPublicMediaUrl'),
      },
      debug: {
        movementDebugOverlays: checked('setting-movementDebugOverlays'),
        objectActionPointDebug: checked('setting-objectActionPointDebug'),
      },
    };
    const gatewayToken = value('setting-gatewayToken');
    const hermesApiKey = value('setting-hermesApiKey');
    const twilioToken = value('setting-twilioToken');
    if (gatewayToken) payload.openclaw.gatewayToken = gatewayToken;
    if (hermesApiKey) payload.hermes.apiKey = hermesApiKey;
    if (twilioToken) payload.sms.twilioAuthToken = twilioToken;
    return payload;
  }

  async function saveAllSettings() {
    if (originalSaveSettings) {
      try { originalSaveSettings(); } catch {}
    }
    const result = await fetchJson('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSettingsPayload()),
    });
    populateForm(result.config);
    window.dispatchEvent(new CustomEvent('vw:settings-saved', { detail: { config: result.config } }));
    window.closeSettingsModal?.();
  }

  async function saveLiveModeAgents() {
    if (isTrialLicense(vwConfig?.license || {})) {
      setStatus('liveModeAgentStatus', 'Agent Live Mode is locked until activation.', 'warn');
      return;
    }
    if (!checked('setting-featureAgentLiveMode')) {
      setStatus('liveModeAgentStatus', 'Turn on Agent Live Mode in Features first.', 'warn');
      renderLiveModeAgents();
      return;
    }
    if (liveModeAgentEdits.size === 0) {
      setStatus('liveModeAgentStatus', 'No Live Mode selection changes to apply.', 'info');
      return;
    }
    setStatus('liveModeAgentStatus', 'Applying Live Mode selection...');
    const changed = [];
    for (const [agentId, enabled] of liveModeAgentEdits.entries()) {
      const result = await fetchJson(`/api/agent/${encodeURIComponent(agentId)}/live-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentLiveModeEnabled: enabled }),
      });
      changed.push(result);
    }
    await refreshLiveModeAgents();
    setStatus('liveModeAgentStatus', `Applied ${changed.length} Live Mode change${changed.length === 1 ? '' : 's'}.`, 'success');
  }

  async function refreshConfig() {
    const config = await fetchJson('/vw-config');
    populateForm(config);
    return config;
  }

  async function testBrowser() {
    if (isTrialLicense(vwConfig?.license || {})) {
      setStatus('browserTestStatus', 'Agent Browser is locked until activation.', 'warn');
      return;
    }
    await fetchJson('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSettingsPayload()),
    });
    const status = await fetchJson('/browser-status');
    setStatus('browserTestStatus', status.locked ? 'Locked until activation.' : status.cdpAvailable ? 'CDP connected.' : 'CDP not reachable yet.', status.cdpAvailable ? 'success' : 'warn');
  }

  async function openBrowserPanel() {
    const panel = $('browserPanel');
    const frame = $('browserPanelFrame');
    const statusEl = $('browserPanelStatus');
    panel.style.display = 'flex';
    const status = await fetchJson('/browser-status');
    if (!status.enabled) {
      statusEl.textContent = status.locked ? 'Agent Browser is locked until activation.' : 'Agent Browser is disabled or not configured.';
      frame.removeAttribute('src');
      return;
    }
    statusEl.textContent = status.cdpAvailable ? 'CDP connected.' : 'Viewer opened; CDP not reachable.';
    frame.src = status.viewerUrl || 'about:blank';
  }

  async function checkSms() {
    if (isTrialLicense(vwConfig?.license || {})) {
      setStatus('smsTestStatus', 'SMS / Twilio is locked until activation.', 'warn');
      return;
    }
    await fetchJson('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSettingsPayload()),
    });
    const status = await fetchJson('/sms-status');
    setStatus('smsTestStatus', status.locked ? 'SMS is locked until activation.' : status.hasCredentials ? 'SMS credentials are configured.' : 'SMS is missing credentials.', status.hasCredentials ? 'success' : 'warn');
  }

  async function openSmsPanel() {
    const panel = $('smsPanel');
    panel.style.display = 'flex';
    const status = await fetchJson('/sms-status');
    if (status.locked) {
      $('smsPanelStatus').textContent = 'SMS / Twilio is locked until activation.';
      $('smsThreadList').innerHTML = '<div class="palette-hint">Activate a license key to use SMS / Twilio.</div>';
      return;
    }
    $('smsPanelStatus').textContent = status.locked ? 'SMS is locked until activation.' : status.hasCredentials ? 'SMS ready.' : 'SMS is not fully configured.';
    const threads = await fetchJson('/sms-threads');
    const list = $('smsThreadList');
    list.innerHTML = '';
    (threads.threads || []).forEach(thread => {
      const row = document.createElement('button');
      row.className = 'sms-thread-row';
      row.textContent = `${thread.phone} (${thread.count})`;
      row.onclick = () => { $('smsTo').value = thread.phone; };
      list.appendChild(row);
    });
    if (!list.children.length) list.innerHTML = '<div class="palette-hint">No local SMS history yet.</div>';
  }

  async function sendSms() {
    const result = await fetchJson('/sms-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: value('smsTo'), body: value('smsBody') }),
    });
    $('smsPanelStatus').textContent = result.ok ? 'Message sent.' : (result.error || 'Send failed.');
    $('smsBody').value = '';
    openSmsPanel();
  }

  async function activateLicense() {
    setStatus('licenseActionStatus', 'Activating...');
    try {
      const result = await fetchJson('/api/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: value('setting-licenseKey') }),
      });
      setStatus('licenseActionStatus', result.ok ? `${result.tierName} activated.` : result.error, result.ok ? 'success' : 'warn');
      await refreshConfig();
    } catch (err) {
      setStatus('licenseActionStatus', err.message, 'warn');
    }
  }

  async function deactivateLicense() {
    await fetchJson('/api/license/deactivate', { method: 'POST' });
    setStatus('licenseActionStatus', 'License removed. Trial mode active.', 'warn');
    await refreshConfig();
  }

  function bind() {
    document.querySelectorAll('.settings-tab').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.settingsTab)));
    $('setting-featureAgentLiveMode')?.addEventListener('change', () => {
      renderLiveModeAgents();
      renderLiveModeLoopStatus();
    });
    $('btn-refreshLiveAgents')?.addEventListener('click', () => refreshLiveModeAgents().catch(err => setStatus('liveModeAgentStatus', err.message, 'warn')));
    $('btn-saveLiveAgents')?.addEventListener('click', () => saveLiveModeAgents().catch(err => setStatus('liveModeAgentStatus', err.message, 'warn')));
    $('btn-refreshLiveLoop')?.addEventListener('click', () => refreshLiveModeLoopStatus().catch(() => {}));
    $('btn-pauseLiveLoop')?.addEventListener('click', () => pauseLiveModeLoop().catch(err => setStatus('liveModeLoopActionStatus', err.message, 'warn')));
    $('btn-resumeLiveLoop')?.addEventListener('click', () => resumeLiveModeLoop().catch(err => setStatus('liveModeLoopActionStatus', err.message, 'warn')));
    $('btn-clearLiveClient')?.addEventListener('click', () => clearLiveModeClientActivity().catch(err => setStatus('liveModeLoopActionStatus', err.message, 'warn')));
    $('btn-activateLicense')?.addEventListener('click', activateLicense);
    $('btn-deactivateLicense')?.addEventListener('click', deactivateLicense);
    $('btn-testBrowser')?.addEventListener('click', () => testBrowser().catch(err => setStatus('browserTestStatus', err.message, 'warn')));
    $('btn-openBrowserPanel')?.addEventListener('click', () => openBrowserPanel().catch(err => setText('browserPanelStatus', err.message)));
    $('btn-browserPanel')?.addEventListener('click', () => openBrowserPanel().catch(err => setText('browserPanelStatus', err.message)));
    $('browserPanelClose')?.addEventListener('click', () => { $('browserPanel').style.display = 'none'; });
    $('btn-testSms')?.addEventListener('click', () => checkSms().catch(err => setStatus('smsTestStatus', err.message, 'warn')));
    $('btn-openSmsPanel')?.addEventListener('click', () => openSmsPanel().catch(err => setText('smsPanelStatus', err.message)));
    $('btn-smsPanel')?.addEventListener('click', () => openSmsPanel().catch(err => setText('smsPanelStatus', err.message)));
    $('smsPanelClose')?.addEventListener('click', () => { $('smsPanel').style.display = 'none'; });
    $('smsSend')?.addEventListener('click', () => sendSms().catch(err => { $('smsPanelStatus').textContent = err.message; }));
    $('btn-testHermes')?.addEventListener('click', async () => {
      setStatus('hermesTestStatus', 'Testing...');
      try {
        const result = await fetchJson('/api/hermes/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ homePath: value('setting-hermesHome'), binary: value('setting-hermesBin') }) });
        setStatus('hermesTestStatus', result.ok ? `Hermes connected (${(result.agents || []).length} profiles).` : (result.error || 'Hermes unavailable.'), result.ok ? 'success' : 'warn');
      } catch (err) {
        setStatus('hermesTestStatus', err.message, 'warn');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    originalSaveSettings = window.saveSettings;
    window.saveSettings = () => saveAllSettings().catch(err => alert(err.message));
    bind();
    refreshConfig().catch(() => {});
  });
})();
