import { createConnectionHelpButton } from './connection-help.mjs?v=20260809-connection-guides-r1';

(() => {
  'use strict';
  if (new URLSearchParams(location.search).get('embedded') === 'settings') {
    document.body.classList.add('provider-settings-embedded');
  }
  const state = { providers: [], selectedId: '', connectionLists: new Map() };
  const $ = id => document.getElementById(id);

  function setStatus(text, kind = '') {
    const el = $('ps-status');
    el.textContent = text || '';
    el.className = 'ps-status' + (kind ? ' ' + kind : '');
  }

  function element(tag, attrs = {}, text = '') {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === 'className') el.className = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key in el) el[key] = value;
      else el.setAttribute(key, value);
    });
    if (text !== '') el.textContent = text;
    return el;
  }

  function currentProvider() { return state.providers.find(provider => provider.id === state.selectedId); }
  function sections(provider) { return provider?.settingsSchema?.sections || []; }
  function providerLinkHref(provider, field) {
    const href = field?.href || '#';
    if (!document.body.classList.contains('provider-settings-embedded')) return href;
    try {
      const target = new URL(href, window.location.href);
      if (target.origin === window.location.origin && target.pathname.endsWith('/models.html')) {
        target.searchParams.set('returnTo', 'provider-sdk');
        target.searchParams.set('provider', provider?.id || '');
        return `${target.pathname}${target.search}${target.hash}`;
      }
    } catch (_) {
      // Keep manifest-provided links usable even when a third-party provider uses a custom scheme.
    }
    return href;
  }
  function healthMessage(provider) {
    const health = provider?.health || {};
    if (health.ok) return health.message || 'Runtime health check passed.';
    if (health.authOk === false) return health.error || health.authGuidance || `Sign in with the ${provider.name || provider.id} native runtime, then test again.`;
    return health.error || health.message || 'This provider needs attention.';
  }

  function renderProviderList() {
    const list = $('ps-provider-list');
    list.replaceChildren(...state.providers.map(provider => {
      const button = element('button', { type:'button', className:'ps-provider-tab' + (provider.id === state.selectedId ? ' active' : '') });
      button.append(element('span', {}, provider.icon || '🤖'), element('span', {}, provider.name || provider.id));
      button.append(element('span', { className:'dot' + (provider.health?.ok ? ' ok' : ''), title:provider.health?.ok ? 'Connected' : 'Needs attention' }));
      button.addEventListener('click', () => { state.selectedId = provider.id; renderProviderList(); renderProvider(); });
      return button;
    }));
  }

  function scalarValue(provider, field) {
    const raw = provider.values?.[field.key];
    if (field.type === 'secret' && raw && typeof raw === 'object') return raw;
    return raw ?? field.default ?? (field.type === 'boolean' ? false : '');
  }

  function makeInput(provider, field, value, prefix = '') {
    const id = `ps-${provider.id}-${prefix}${field.key}`;
    if (field.type === 'boolean') {
      const wrap = element('label', { className:'ps-check' });
      const input = element('input', { id, type:'checkbox', checked:!!value, dataset:{ settingKey:field.key } });
      wrap.append(input, element('span', {}, field.label || field.key));
      return { root:wrap, input };
    }
    if (field.type === 'select') {
      const select = element('select', { id, dataset:{ settingKey:field.key } });
      (field.options || []).forEach(option => select.append(element('option', { value:String(option.value), selected:String(option.value) === String(value) }, option.label || option.value)));
      return { root:select, input:select };
    }
    const secretMeta = field.type === 'secret' && value && typeof value === 'object' ? value : null;
    const input = element('input', {
      id,
      type:field.type === 'secret' ? 'password' : (field.type === 'number' ? 'number' : 'text'),
      value:secretMeta ? '' : (value ?? ''),
      placeholder:secretMeta?.configured ? 'Configured — leave blank to preserve' : (field.placeholder || ''),
      required:!!field.required,
      autocomplete:field.type === 'secret' ? 'new-password' : 'off',
      dataset:{ settingKey:field.key }
    });
    ['min','max','step'].forEach(key => { if (field[key] != null) input[key] = field[key]; });
    return { root:input, input };
  }

  function renderConnectionList(provider, field, value) {
    const root = element('div', { className:'ps-connection-list', dataset:{ connectionKey:field.key } });
    const rows = Array.isArray(value) ? value.map(row => ({ ...row })) : [];
    state.connectionLists.set(field.key, { rows, field, root });
    const renderRows = () => {
      const cards = rows.map((row, index) => {
        const card = element('div', { className:'ps-connection' });
        const head = element('div', { className:'ps-connection-head' });
        head.append(element('strong', {}, `${field.itemLabel || 'Connection'} ${index + 1}`));
        const remove = element('button', { type:'button', className:'ps-button danger' }, 'Remove');
        remove.addEventListener('click', () => { rows.splice(index, 1); renderRows(); });
        head.append(remove);
        const grid = element('div', { className:'ps-connection-grid' });
        (field.itemFields || []).forEach(child => {
          const label = element('label');
          const childLabel = element('span', { className:'ps-child-label-with-info' });
          childLabel.append(element('span', {}, child.label || child.key), createConnectionHelpButton(provider.id, child));
          label.append(childLabel);
          const current = child.type === 'secret'
            ? { value:'', configured:!!row[`${child.key}Configured`] }
            : (row[child.key] ?? child.default ?? (child.type === 'boolean' ? false : ''));
          const control = makeInput(provider, child, current, `${field.key}-${index}-`);
          control.input.dataset.connectionIndex = String(index);
          control.input.dataset.connectionField = child.key;
          delete control.input.dataset.settingKey;
          label.append(control.root);
          grid.append(label);
        });
        card.append(head, grid);
        return card;
      });
      const add = element('button', { type:'button', className:'ps-button secondary' }, '＋ Add connection');
      add.addEventListener('click', () => {
        const next = {};
        (field.itemFields || []).forEach(child => { next[child.key] = child.default ?? (child.type === 'boolean' ? true : ''); });
        rows.push(next); renderRows();
      });
      root.replaceChildren(...cards, add);
    };
    renderRows();
    return root;
  }

  function integrationTag(text, kind = '') { return element('span', { className:'ps-integration-tag' + (kind ? ' ' + kind : '') }, text); }

  function renderTransportSection(provider) {
    const transports = provider.connectionSchema?.transports || [];
    const card = element('section', { className:'ps-section ps-transport-section' });
    card.append(element('h3', {}, 'Runtime transports'));
    card.append(element('p', { className:'ps-section-description' }, 'The provider manifest declares where each runtime actually executes. Endpoint fallback applies only to real HTTP or WebSocket services.'));
    const list = element('div', { className:'ps-integration-list' });
    transports.forEach(transport => {
      const row = element('div', { className:'ps-integration-row ps-transport-row' });
      const tags = element('div', { className:'ps-integration-tags' });
      tags.append(integrationTag(transport.kind === 'network' ? 'network endpoint' : 'native process', transport.kind === 'network' ? 'ok' : ''));
      if (transport.kind === 'network') {
        const mode = provider.values?.[transport.modeKey] || 'auto';
        tags.append(integrationTag(mode === 'auto' ? 'auto-detect' : mode));
        if (provider.health?.endpointLocation) tags.append(integrationTag(`active: ${provider.health.endpointLocation}`, 'ok'));
        row.append(
          element('div', { className:'ps-integration-title' }, transport.label || transport.id || 'Network connection'),
          tags,
          element('div', { className:'ps-integration-paths' }, (transport.defaultEndpoints || []).map(item => item.label || item.location).join(' → '))
        );
        row.append(element('div', { className:'ps-help' }, 'Resolution performs authenticated health/capability checks and pins exactly one endpoint before a run. It never broadcasts a task to every candidate.'));
      } else {
        tags.append(integrationTag('server runtime'));
        row.append(
          element('div', { className:'ps-integration-title' }, transport.label || transport.id || 'Native CLI'),
          tags,
          element('div', { className:'ps-integration-paths' }, transport.executableKey || 'binary')
        );
        row.append(element('div', { className:'ps-help' }, 'This executable must run inside the Virtual World server/container. host.docker.internal cannot execute a Windows CLI; that framework needs a real host API bridge.'));
      }
      list.append(row);
    });
    if (!transports.length) list.append(element('div', { className:'ps-empty' }, 'This legacy extension does not declare a transport schema. Its existing adapter remains available without automatic endpoint resolution.'));
    card.append(list);
    return card;
  }

  function renderIntegrationSection(provider) {
    const resources = provider.resourceSchema || [];
    const skillRoots = provider.skillSchema || [];
    const card = element('section', { className:'ps-section ps-integration-section' });
    card.append(element('h3', {}, 'Agent Desk files & skills'));
    card.append(element('p', { className:'ps-section-description' }, 'Manifest rules define the exact files and skill roots My Virtual World may show or edit. Undeclared and sensitive paths stay hidden.'));
    const resourceList = element('div', { className:'ps-integration-list' });
    resources.forEach(resource => {
      const row = element('div', { className:'ps-integration-row' });
      const tags = element('div', { className:'ps-integration-tags' });
      if (resource.readable === false) tags.append(integrationTag('hidden', 'danger'));
      else tags.append(integrationTag(resource.runtimeActive ? 'runtime active' : 'world only', resource.runtimeActive ? 'ok' : ''));
      if (resource.readable !== false) tags.append(integrationTag(resource.writable ? 'editable' : 'read only', resource.writable ? 'ok' : ''));
      if (resource.generated) tags.append(integrationTag('managed'));
      row.append(
        element('div', { className:'ps-integration-title' }, resource.label || resource.id || 'Native resource'),
        tags,
        element('div', { className:'ps-integration-paths' }, (resource.paths || []).join(' · '))
      );
      if (resource.description) row.append(element('div', { className:'ps-help' }, resource.description));
      resourceList.append(row);
    });
    if (!resources.length) resourceList.append(element('div', { className:'ps-empty' }, 'This provider exposes no Agent Desk files.'));
    card.append(resourceList, element('h4', { className:'ps-integration-subtitle' }, 'Skill roots'));
    const skillList = element('div', { className:'ps-integration-list' });
    skillRoots.forEach(root => {
      const row = element('div', { className:'ps-integration-row' });
      const tags = element('div', { className:'ps-integration-tags' });
      tags.append(integrationTag(root.runtimeActive ? 'runtime active' : 'stored only', root.runtimeActive ? 'ok' : ''));
      tags.append(integrationTag(root.writable ? 'install/edit' : 'read only', root.writable ? 'ok' : ''));
      row.append(
        element('div', { className:'ps-integration-title' }, root.label || root.id || 'Agent skills'),
        tags,
        element('div', { className:'ps-integration-paths' }, root.path || '')
      );
      if ((root.sharedRoots || []).length) row.append(element('div', { className:'ps-help' }, 'Native shared roots: ' + root.sharedRoots.join(' · ')));
      skillList.append(row);
    });
    if (!skillRoots.length) skillList.append(element('div', { className:'ps-empty' }, 'This provider does not expose installable AgentSkills.'));
    card.append(skillList);
    return card;
  }

  function renderProvider() {
    const provider = currentProvider();
    $('ps-loading').hidden = true;
    $('ps-provider').hidden = !provider;
    if (!provider) return;
    state.connectionLists.clear();
    $('ps-icon').textContent = provider.icon || '🤖';
    $('ps-name').textContent = provider.name || provider.id;
    $('ps-provider-help').replaceChildren(createConnectionHelpButton(provider.id, { label:`${provider.name || provider.id} setup` }));
    $('ps-description').textContent = provider.description || '';
    const health = $('ps-health');
    health.textContent = provider.health?.ok ? 'Connected' : (provider.health?.authOk === false ? 'Login required' : 'Needs attention');
    health.className = 'ps-health' + (provider.health?.ok ? ' ok' : '');
    const caps = Object.entries(provider.capabilities || {}).filter(([, enabled]) => enabled).map(([name]) => element('span', { className:'ps-capability' }, name));
    $('ps-capabilities').replaceChildren(...caps);
    setStatus(healthMessage(provider), provider.health?.ok ? 'ok' : 'error');
    const cards = [renderTransportSection(provider), ...sections(provider).map(section => {
      const card = element('section', { className:'ps-section' });
      card.append(element('h3', {}, section.label || section.id));
      if (section.description) card.append(element('p', { className:'ps-section-description' }, section.description));
      (section.fields || []).forEach(field => {
        if (field.type === 'link') {
          const row = element('div', { className:'ps-field' });
          const label = element('div', { className:'ps-label ps-label-with-info' });
          label.append(element('span', {}, field.label || field.key), createConnectionHelpButton(provider.id, field));
          row.append(label, element('a', { className:'ps-link', href:providerLinkHref(provider, field)}, field.actionLabel || 'Open'));
          card.append(row); return;
        }
        const row = element('div', { className:'ps-field' });
        const labelBox = element('div');
        const label = element('div', { className:'ps-label ps-label-with-info' });
        label.append(element('span', {}, field.label || field.key), createConnectionHelpButton(provider.id, field));
        labelBox.append(label);
        if (field.help) labelBox.append(element('div', { className:'ps-help' }, field.help));
        const control = element('div', { className:'ps-control' });
        const value = scalarValue(provider, field);
        control.append(field.type === 'connection-list' ? renderConnectionList(provider, field, value) : makeInput(provider, field, value).root);
        row.append(labelBox, control); card.append(row);
      });
      return card;
    })];
    cards.push(renderIntegrationSection(provider));
    $('ps-form').replaceChildren(...cards);
  }

  function collectValues() {
    const provider = currentProvider();
    const values = {};
    sections(provider).forEach(section => (section.fields || []).forEach(field => {
      if (field.type === 'link') return;
      if (field.type === 'connection-list') {
        const list = state.connectionLists.get(field.key);
        values[field.key] = [...list.root.querySelectorAll('.ps-connection')].map(card => {
          const row = {};
          card.querySelectorAll('[data-connection-field]').forEach(input => {
            row[input.dataset.connectionField] = input.type === 'checkbox' ? input.checked : (input.type === 'number' ? Number(input.value) : input.value);
          });
          return row;
        });
        return;
      }
      const input = $('ps-form').querySelector(`[data-setting-key="${CSS.escape(field.key)}"]`);
      if (!input) return;
      values[field.key] = input.type === 'checkbox' ? input.checked : (input.type === 'number' ? Number(input.value) : input.value);
    }));
    return values;
  }

  async function requestJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error?.message || data.error || response.statusText);
    return data;
  }

  async function load(preferredId = state.selectedId) {
    $('ps-refresh').disabled = true;
    try {
      const data = await requestJson('/api/providers/settings', { cache:'no-store' });
      state.providers = data.providers || [];
      state.selectedId = state.providers.some(provider => provider.id === preferredId) ? preferredId : (state.providers[0]?.id || '');
      renderProviderList(); renderProvider();
    } catch (error) {
      $('ps-loading').hidden = false;
      $('ps-loading').textContent = 'Provider settings failed to load: ' + error.message;
    } finally { $('ps-refresh').disabled = false; }
  }

  async function save() {
    const provider = currentProvider(); if (!provider) return;
    $('ps-save').disabled = true; setStatus('Validating and applying settings…');
    try {
      await requestJson('/api/providers/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ providerId:provider.id, values:collectValues() }) });
      await load(provider.id);
      setStatus('Settings saved. Secrets left blank were preserved and agent discovery was refreshed.', 'ok');
      window.parent?.dispatchEvent?.(new CustomEvent('vw:provider-settings-saved', { detail:{ providerId:provider.id } }));
    } catch (error) { setStatus(error.message, 'error'); }
    finally { $('ps-save').disabled = false; }
  }

  async function test() {
    const provider = currentProvider(); if (!provider) return;
    $('ps-test').disabled = true; setStatus('Testing these connection settings…');
    try {
      const data = await requestJson('/api/providers/test', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ providerId:provider.id, values:collectValues() }) });
      setStatus(data.message || 'Connection test passed.', 'ok');
      await load(provider.id);
    } catch (error) { setStatus(error.message, 'error'); }
    finally { $('ps-test').disabled = false; }
  }

  async function discover() {
    $('ps-discover').disabled = true; setStatus('Refreshing native agent discovery…');
    try {
      const data = await requestJson('/api/providers/refresh', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
      const count = Array.isArray(data.agents) ? data.agents.length : 0;
      await load(state.selectedId);
      setStatus(`Discovery refreshed. ${count} agent${count === 1 ? '' : 's'} available or remembered.`, 'ok');
      window.parent?.dispatchEvent?.(new CustomEvent('vw:agents-changed', { detail:{ reason:'provider-discovery' } }));
    } catch (error) { setStatus(error.message, 'error'); }
    finally { $('ps-discover').disabled = false; }
  }

  $('ps-refresh').addEventListener('click', () => load());
  $('ps-discover').addEventListener('click', discover);
  $('ps-save').addEventListener('click', save);
  $('ps-test').addEventListener('click', test);
  load(new URLSearchParams(location.search).get('provider') || location.hash.slice(1));
})();
