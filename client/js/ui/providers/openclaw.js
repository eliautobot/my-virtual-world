// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// OpenClaw's sub-menu in Agent Providers (docs/features/agent-providers.md): its gateway, agents, models, tools and
// plugins, skills, automations, approvals, sessions and every setting it has - what OpenClaw's own Control UI offers, through its gateway.
// Every call goes through the server (POST /api/agent-providers/call: the connection's managers only, a fixed list of
// calls, no secret's value ever comes back); every change is shown first - what it changes, from what to what - and waits
// for the person's OK. The Settings page is drawn from OpenClaw's own description of its settings (config.schema.lookup:
// labels, help, which change needs a restart, which values are secret), so a newer OpenClaw's settings show by themselves.
import { h, esc } from '../../core/util.js';

export const TABS = Object.freeze([
  { id: 'overview', label: 'Overview', icon: '📊' }, { id: 'agents', label: 'Agents', icon: '🤖' }, { id: 'models', label: 'Models', icon: '🧠' },
  { id: 'tools', label: 'Tools', icon: '🔧' }, { id: 'skills', label: 'Skills', icon: '🧩' }, { id: 'automations', label: 'Automations', icon: '⏰' }, { id: 'approvals', label: 'Approvals', icon: '✋' },
  { id: 'sessions', label: 'Sessions', icon: '💬' }, { id: 'settings', label: 'Settings', icon: '⚙️' },
]);

const PAGES = { overview, agents, models, tools, skills, automations, approvals, sessions, settings };
/** Draws page `tab` into `el`. ctx: { call(method, params), confirm({ title, rows, details, note, yes }), toast(text, kind), openChat(nativeId) }. */
export async function render(tab, el, ctx) {
  el.innerHTML = '<p class="hint">Loading…</p>';
  try { await PAGES[tab](el, ctx); }
  catch (e) { el.innerHTML = `<div class="ap-card bad"><h4>Could not read it</h4><p>${esc(e.message)}</p>${/scope|admin/i.test(e.message) ? '<p class="hint">This connection has Chat only access: edit it and choose Full to see and change OpenClaw\'s settings.</p>' : ''}</div>`; }
}

// ------------------------------------------------------------------ small helpers
const ago = ms => { if (!Number.isFinite(ms)) return ''; const s = Math.round((Date.now() - ms) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`; };
const until = ms => { if (!Number.isFinite(ms)) return ''; const s = Math.round((ms - Date.now()) / 1000); return s <= 0 ? 'now' : s < 3600 ? `in ${Math.ceil(s / 60)} min` : s < 86400 ? `in ${Math.round(s / 3600)} h` : `in ${Math.round(s / 86400)} d`; };
const span = ms => { const s = Math.round(ms / 1000); const d = Math.floor(s / 86400), hh = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d} d ${hh} h` : hh ? `${hh} h ${m} min` : `${m} min`; };
const bytes = n => (!Number.isFinite(n) ? '' : n > 1e12 ? `${(n / 1e12).toFixed(1)} TB` : n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);
const kv = (k, v) => (v === undefined || v === null || v === '' ? '' : `<div class="kv2"><span>${esc(k)}</span><b>${esc(String(v))}</b></div>`);
const shown = v => (v && typeof v === 'object' && v.secret ? (v.set ? '•••••• (set)' : '(not set)') : v === undefined ? '(not set)' : typeof v === 'string' ? (v === '' ? '(empty)' : v) : JSON.stringify(v));
const agentName = a => (a.identity && a.identity.name) || a.name || a.id;
const modelRef = m => (m.provider ? `${m.provider}/${m.id}` : m.id);
/** A setting's choices as OpenClaw's schema gives them: an enum, or (its usual form) a list of constants. */
const choicesOf = sc => (!sc ? null : Array.isArray(sc.enum) ? sc.enum : Array.isArray(sc.anyOf) && sc.anyOf.length && sc.anyOf.every(x => x && 'const' in x) ? sc.anyOf.map(x => x.const) : null);
function wire(el, map) { el.onclick = e => { const b = e.target.closest('[data-do]'); if (b && map[b.dataset.do]) map[b.dataset.do](b, e); }; }
async function act(ctx, b, fn, done = 'Done') {
  if (b) b.disabled = true;
  try { await fn(); if (done) ctx.toast(done, 'good'); return true; }
  catch (e) { ctx.toast(e.message, 'bad'); return false; }
  finally { if (b) b.disabled = false; }
}

// ------------------------------------------------------------------ Overview
async function overview(el, ctx) {
  const [sys, upd] = await Promise.all([ctx.call('system.info'), ctx.call('update.status').catch(() => null)]);
  const ua = upd && upd.updateAvailable;
  el.innerHTML = `<div class="op-grid">
    <div class="ap-card"><h4>🔌 Gateway</h4>${kv('Uptime', Number.isFinite(sys.uptimeMs) ? span(sys.uptimeMs) : '')}${kv('Port', sys.port)}${kv('Process', sys.pid)}
      ${kv('Event loop', sys.eventLoop ? (sys.eventLoop.degraded ? `Degraded: ${(sys.eventLoop.reasons || []).join(', ')}` : `Healthy (p99 ${Math.round(sys.eventLoop.delayP99Ms || 0)} ms)`) : '')}
      ${kv('Memory used', sys.processMemory ? bytes(sys.processMemory.rssBytes) : '')}</div>
    <div class="ap-card"><h4>🖥️ Host</h4>${kv('Machine', sys.machineName)}${kv('System', sys.osLabel || sys.platform)}${kv('Processor', sys.cpuModel ? `${sys.cpuModel} (${sys.cpuCount} cores)` : '')}
      ${kv('Memory', Number.isFinite(sys.memoryTotalBytes) ? `${bytes(sys.memoryTotalBytes - sys.memoryFreeBytes)} of ${bytes(sys.memoryTotalBytes)} in use` : '')}
      ${kv('Disk', Number.isFinite(sys.diskTotalBytes) ? `${bytes(sys.diskAvailableBytes)} free of ${bytes(sys.diskTotalBytes)}` : '')}${kv('Node.js', sys.nodeVersion)}</div>
    <div class="ap-card${ua ? ' wait' : ''}"><h4>⬆️ Updates</h4>${ua ? `${kv('Installed', ua.currentVersion)}${kv('Available', ua.latestVersion)}${kv('Channel', ua.channel)}
      <p class="hint">Update OpenClaw on the gateway's machine: <code>openclaw update</code>. My Virtual World reconnects by itself afterwards.</p>` : '<p class="hint">OpenClaw is up to date.</p>'}
      ${upd && upd.schedule ? kv('Automatic updates', upd.schedule.autoEnabled ? 'On' : 'Off') : ''}</div>
  </div>`;
}

// ------------------------------------------------------------------ Agents
async function agents(el, ctx) {
  const [r, m] = await Promise.all([ctx.call('agents.list'), ctx.call('models.list').catch(() => ({ models: [] }))]);
  const list = (r.agents || []).filter(a => a.kind !== 'system');
  const models = (m.models || []).filter(x => x.available !== false).map(modelRef);
  const modelOf = a => (a.model && (a.model.primary || a.model)) || a.effectiveModel || '';
  el.innerHTML = `<div class="op-list">${list.map(a => `<div class="op-row" data-id="${esc(a.id)}">
      <span class="ap-av" aria-hidden="true">${esc((a.identity && a.identity.emoji) || '🤖')}</span>
      <span class="op-main"><b>${esc(agentName(a))}</b>${a.id === r.defaultId ? ' <span class="tag">Default</span>' : ''}<small>${esc(a.id)}${typeof modelOf(a) === 'string' && modelOf(a) ? ` · ${esc(modelOf(a))}` : ''}</small></span>
      <span class="op-acts"><button type="button" class="btn small" data-do="chat">💬 Chat</button><button type="button" class="btn small" data-do="rename">Rename</button>
        <button type="button" class="btn small" data-do="model">Model…</button>${a.id === r.defaultId ? '' : '<button type="button" class="btn small danger" data-do="del">Delete</button>'}</span></div>`).join('') || '<p class="hint">No agents.</p>'}</div>
    <h4 class="ap-h">New agent</h4>
    <form class="op-form row wrap"><input class="input op-name" maxlength="60" placeholder="Name" required><input class="input op-emoji" maxlength="4" placeholder="Emoji" style="width:70px">
      <select class="input op-model"><option value="">Default model</option>${models.map(x => `<option>${esc(x)}</option>`).join('')}</select><button class="btn primary" type="submit">Create</button></form>`;
  const row = b => list.find(a => a.id === b.closest('.op-row').dataset.id);
  /** An inline editor in the agent's row: its name, or its model (a choice of the available ones). */
  const editIn = (b, what) => {
    const a = row(b), r = b.closest('.op-row'), cur = what === 'name' ? agentName(a) : (typeof modelOf(a) === 'string' ? modelOf(a) : '');
    const ed = h(`<form class="op-inline row">${what === 'name' ? `<input class="input" maxlength="60" value="${esc(cur)}" aria-label="Name">`
      : `<select class="input" aria-label="Model"><option value="">The default model</option>${models.map(x => `<option${x === cur ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>`}
      <button class="btn small primary" type="submit">Save</button><button type="button" class="btn small" data-do="cancel">Cancel</button></form>`);
    r.querySelector('.op-acts').classList.add('hidden');
    r.appendChild(ed);
    ed.querySelector('input, select').focus();
    ed.querySelector('[data-do="cancel"]').onclick = e => { e.stopPropagation(); ed.remove(); r.querySelector('.op-acts').classList.remove('hidden'); };
    ed.onsubmit = async e => {
      e.preventDefault();
      const v = ed.querySelector('input, select').value.trim();
      if (v === cur || (what === 'name' && !v)) { ed.remove(); r.querySelector('.op-acts').classList.remove('hidden'); return; }
      if (!await ctx.confirm({ title: what === 'name' ? 'Rename an agent' : 'Change an agent\'s model', rows: [{ label: `${a.id}: ${what}`, from: cur || '(default)', to: v || '(default)' }] })) return;
      if (await act(ctx, e.submitter, () => ctx.call('agents.update', { agentId: a.id, ...(what === 'name' ? { name: v } : { model: v || null }) }), what === 'name' ? 'Renamed' : 'Model changed')) render('agents', el, ctx);
    };
  };
  wire(el, {
    chat: b => ctx.openChat(row(b).id),
    rename: b => editIn(b, 'name'),
    model: b => editIn(b, 'model'),
    del: async b => {
      const a = row(b);
      if (!await ctx.confirm({ title: `Delete ${agentName(a)}?`, rows: [{ label: 'Agent', from: `${agentName(a)} (${a.id})`, to: 'deleted' }], note: 'Its workspace files stay on the gateway\'s machine.', danger: true })) return;
      if (await act(ctx, b, () => ctx.call('agents.delete', { agentId: a.id, deleteFiles: false }), 'Deleted')) render('agents', el, ctx);
    },
  });
  el.querySelector('.op-form').onsubmit = async e => {
    e.preventDefault();
    const name = el.querySelector('.op-name').value.trim(), emoji = el.querySelector('.op-emoji').value.trim(), model = el.querySelector('.op-model').value;
    if (!name) return;
    if (!await ctx.confirm({ title: 'Create an agent', rows: [{ label: 'Name', from: '', to: name }, ...(emoji ? [{ label: 'Emoji', from: '', to: emoji }] : []), { label: 'Model', from: '', to: model || '(default)' }] })) return;
    if (await act(ctx, e.submitter, () => ctx.call('agents.create', { name, ...(emoji ? { emoji } : {}), ...(model ? { model } : {}) }), `Created ${name}`)) render('agents', el, ctx);
  };
}

// ------------------------------------------------------------------ Models
async function models(el, ctx) {
  const [m, auth, cfg] = await Promise.all([ctx.call('models.list'), ctx.call('models.authStatus').catch(() => null), ctx.call('config.get')]);
  const def = cfg.config && cfg.config.agents && cfg.config.agents.defaults && cfg.config.agents.defaults.model;
  const primary = typeof def === 'string' ? def : def && def.primary;
  const list = m.models || [];
  el.innerHTML = `<div class="op-list">${list.map(x => {
    const ref = modelRef(x);
    return `<div class="op-row" data-ref="${esc(ref)}"><span class="op-main"><b>${esc(x.name || x.id)}</b>${ref === primary ? ' <span class="tag set">Default</span>' : ''}${x.available === false ? ' <span class="tag">Unavailable</span>' : ''}
      <small>${esc(ref)}${Number.isFinite(x.contextWindow) ? ` · ${Math.round(x.contextWindow / 1000)}k context` : ''}${x.reasoning ? ' · reasoning' : ''}${Array.isArray(x.thinkingLevels) ? ` · thinking: ${x.thinkingLevels.map(t => t.id).join(', ')}` : ''}</small></span>
      <span class="op-acts">${ref === primary || x.available === false ? '' : '<button type="button" class="btn small" data-do="default">Make default</button>'}</span></div>`;
  }).join('') || '<p class="hint">No models configured.</p>'}</div>
    ${auth && auth.providers && auth.providers.length ? `<h4 class="ap-h">Signed in to</h4><div class="op-list">${auth.providers.map(p => `<div class="op-row"><span class="op-main"><b>${esc(p.displayName || p.provider)}</b>
      <small>${esc(p.status || '')}${p.apiKey && p.apiKey.source ? ` · key from ${esc(p.apiKey.source)}` : ''}${p.profiles && p.profiles.length ? ` · ${p.profiles.length} account(s)` : ''}</small></span></div>`).join('')}</div>` : ''}
    <p class="hint">Add a model provider, or change one's key, in Settings → Models.</p>`;
  wire(el, {
    default: async b => {
      const ref = b.closest('.op-row').dataset.ref;
      if (!await ctx.confirm({ title: 'Change the default model', rows: [{ label: 'agents.defaults.model.primary', from: primary || '(none)', to: ref }], note: 'Agents without a model of their own use it; it applies at once.' })) return;
      if (await act(ctx, b, () => ctx.call('config.patch', { raw: JSON.stringify({ agents: { defaults: { model: { primary: ref } } } }), baseHash: cfg.hash, note: 'My Virtual World: default model' }), 'Default model changed')) render('models', el, ctx);
    },
  });
}

// ------------------------------------------------------------------ Tools and plugins
// An agent's tools as OpenClaw has them in effect in its main session (built in, from plugins, channels and MCP servers,
// with their risk; an older gateway without tools.effective: its catalogue), its tool profile - all agents' and this one's
// own, each offered only where the gateway's settings have it - and the plugins installed on the gateway. Switching a
// plugin on shows what it declares first and sends OpenClaw's review token of exactly that (its own consent step).
const SOURCE = { core: 'Built in', plugin: 'From plugins', channel: 'From channels', mcp: 'From MCP servers' };
const PLUGIN_STATE = { enabled: ['On', ' set'], disabled: ['Off', ''], 'needs-setup': ['Needs setup', ' warn'] };
const TOOLS_AGENT = new WeakMap();   // the agent a Tools page shows (kept while it is drawn again)
async function tools(el, ctx) {
  const ag = await ctx.call('agents.list');
  const list = (ag.agents || []).filter(a => a.kind !== 'system');
  const id = list.some(a => a.id === TOOLS_AGENT.get(el)) ? TOOLS_AGENT.get(el) : (ag.defaultId || (list[0] && list[0].id));
  if (!id) { el.innerHTML = '<p class="hint">No agents.</p>'; return; }
  const sessionKey = ag.scope === 'global' ? 'global' : `agent:${id}:${ag.mainKey || 'main'}`;
  const own = /^[\w-]+$/.test(id) ? `agents.entries.${id}.tools.profile` : null;
  const [eff, cat, cfg, plug, allSc, ownSc] = await Promise.all([
    ctx.call('tools.effective', { agentId: id, sessionKey }).catch(() => null), ctx.call('tools.catalog', { agentId: id }).catch(() => null),
    ctx.call('config.get'), ctx.call('plugins.list').catch(() => null),
    lookup(ctx, 'tools.profile').catch(() => null), own ? lookup(ctx, own).catch(() => null) : null]);
  const groups = (eff || cat || {}).groups || [];
  const label = Object.fromEntries(((cat && cat.profiles) || []).map(p => [p.id, p.label]));
  const named = v => (v ? label[v] || words(v) : '');
  const all = at(cfg.config, 'tools.profile'), mine = own ? at(cfg.config, own) : undefined;
  const choice = (sc, cur, blank) => { const c = choicesOf(sc && sc.schema); return c ? `<select class="input">${blank ? `<option value=""${cur === undefined ? ' selected' : ''}>${esc(blank)}</option>` : ''}${c.map(v => `<option value="${esc(String(v))}"${String(cur) === String(v) ? ' selected' : ''}>${esc(named(v))}</option>`).join('')}</select>` : ''; };
  const plugins = ((plug && plug.plugins) || []).filter(p => p.installed).sort((a, b) => (b.enabled - a.enabled) || String(a.name).localeCompare(b.name));
  const count = groups.reduce((n, g) => n + (g.tools || []).length, 0);
  el.innerHTML = `${list.length > 1 ? `<label class="op-pick">Agent <select class="input op-agent">${list.map(a => `<option value="${esc(a.id)}"${a.id === id ? ' selected' : ''}>${esc(agentName(a))}</option>`).join('')}</select></label>` : ''}
    <div class="op-grid">
      ${allSc && choicesOf(allSc.schema) ? `<form class="ap-card op-prof" data-path="tools.profile" data-reload="${esc(allSc.reloadKind || '')}"><h4>Tool profile: all agents</h4><p class="hint">${esc((allSc.hint && allSc.hint.help) || '')}</p>
        <div class="row">${choice(allSc, all, all === undefined ? '(OpenClaw\'s default)' : '')}<button class="btn small primary" type="submit">Save</button></div></form>` : ''}
      ${ownSc && choicesOf(ownSc.schema) ? `<form class="ap-card op-prof" data-path="${esc(own)}" data-reload="${esc(ownSc.reloadKind || '')}"><h4>Tool profile: ${esc(agentName(list.find(a => a.id === id) || { id }))}</h4><p class="hint">${esc((ownSc.hint && ownSc.hint.help) || '')}</p>
        <div class="row">${choice(ownSc, mine, `Same as all agents${all ? ` (${named(all)})` : ''}`)}<button class="btn small primary" type="submit">Save</button></div></form>` : ''}
    </div>
    <h4 class="ap-h">${eff ? `Tools in effect${eff.profile ? ` · ${esc(named(eff.profile))} profile` : ''}` : 'Tools it can have'} · ${count}</h4>
    ${((eff && eff.notices) || []).map(n => `<p class="hint${n.severity === 'warning' ? ' op-err' : ''}">${esc(n.message)}${n.servers && n.servers.length ? ` (${esc(n.servers.join(', '))})` : ''}</p>`).join('')}
    <input type="search" class="input op-search op-tsearch" placeholder="Search ${count} tools"><div class="op-tools"></div>
    <h4 class="ap-h">Plugins installed on the gateway · ${plugins.length}</h4>
    ${plug && plug.mutationAllowed === false ? '<p class="hint">This gateway\'s plugins are managed outside it (a read-only or managed configuration): change them on its machine.</p>' : ''}
    <input type="search" class="input op-search op-psearch" placeholder="Search ${plugins.length} plugins"><div class="op-list op-plugins"></div>`;
  const drawTools = q => {
    const t = (q || '').toLowerCase();
    el.querySelector('.op-tools').innerHTML = groups.map(g => {
      const rows = (g.tools || []).filter(x => !t || `${x.label} ${x.id} ${x.description}`.toLowerCase().includes(t));
      if (!rows.length) return '';
      return `<details class="op-tgroup"${t ? ' open' : ''}><summary><b>${esc(g.label || SOURCE[g.source] || g.id)}</b> <small>${rows.length}${g.pluginId ? ` · ${esc(g.pluginId)}` : ''}</small></summary><div class="op-list">${rows.map(x => `<div class="op-row"><span class="op-main"><b>${esc(x.label || x.id)}</b>${x.label && x.label !== x.id ? ` <code>${esc(x.id)}</code>` : ''}
        ${x.risk && x.risk !== 'low' ? ` <span class="tag${x.risk === 'high' ? ' warn' : ''}">${x.risk === 'high' ? 'High risk' : 'Medium risk'}</span>` : ''}${x.deniedBySession ? ' <span class="tag">Off in this session</span>' : ''}${x.optional ? ' <span class="tag">Optional</span>' : ''}
        <small>${esc(x.description || '')}${x.mcpServer ? ` · MCP server ${esc(x.mcpServer)}` : x.pluginId && !g.pluginId ? ` · ${esc(x.pluginId)}` : ''}</small></span></div>`).join('')}</div></details>`;
    }).join('') || '<p class="hint">No tools match.</p>';
  };
  const drawPlugins = q => {
    const t = (q || '').toLowerCase(), can = !plug || plug.mutationAllowed !== false;
    el.querySelector('.op-plugins').innerHTML = plugins.filter(p => !t || `${p.name} ${p.id} ${p.description}`.toLowerCase().includes(t)).map(p => {
      const [word, cls] = PLUGIN_STATE[p.state] || [words(p.state || ''), ''];
      return `<div class="op-row" data-id="${esc(p.id)}"><span class="op-main"><b>${esc(p.name || p.id)}</b> <span class="tag${cls}">${esc(word)}</span>
        <small>${esc(p.description || '')}</small><small>${esc(p.id)}${p.version ? ` · ${esc(p.version)}` : ''}${p.origin ? ` · ${esc(p.origin)}` : ''}</small></span>
        <span class="op-acts">${can ? `<button type="button" class="btn small" data-do="plugin">${p.enabled ? 'Switch off' : 'Switch on'}</button>` : ''}</span></div>`;
    }).join('') || '<p class="hint">No plugins match.</p>';
  };
  drawTools(''); drawPlugins('');
  el.querySelector('.op-tsearch').oninput = e => drawTools(e.target.value);
  el.querySelector('.op-psearch').oninput = e => drawPlugins(e.target.value);
  const pick = el.querySelector('.op-agent');
  if (pick) pick.onchange = () => { TOOLS_AGENT.set(el, pick.value); render('tools', el, ctx); };
  for (const f of el.querySelectorAll('.op-prof')) f.onsubmit = async e => {
    e.preventDefault();
    const path = f.dataset.path, v = f.querySelector('select').value, cur = at(cfg.config, path);
    if ((v || undefined) === cur) return ctx.toast('Nothing changed');
    if (!await ctx.confirm({ title: 'Change a tool profile', rows: [{ label: path, from: cur === undefined ? (path === own ? 'same as all agents' : '(default)') : named(cur), to: v ? named(v) : 'same as all agents', restart: f.dataset.reload === 'restart' }],
      note: f.dataset.reload === 'restart' ? 'It takes effect when the gateway restarts.' : 'It applies to the next run.' })) return;
    if (await act(ctx, e.submitter, () => ctx.call('config.patch', { raw: JSON.stringify(nest(path, v || null)), baseHash: cfg.hash, note: 'My Virtual World: tool profile' }), 'Tool profile changed')) render('tools', el, ctx);
  };
  wire(el, {
    plugin: async b => {
      const p = plugins.find(x => x.id === b.closest('.op-row').dataset.id), on = !p.enabled;
      let token = null, details = [];
      if (on) {
        const i = await ctx.call('plugins.inspect', { pluginId: p.id }).catch(e => { ctx.toast(e.message, 'bad'); return undefined; });
        if (i === undefined) return;
        const d = (i && i.declared) || {};
        // (its contracts name what it registers; those for its tools are its tools again)
        const contracts = Array.isArray(d.contracts) ? d.contracts.filter(c => !/^tools?:/.test(String(c))) : [];
        details = [['Tools', d.tools], ['Model providers', d.providers], ['Channels', d.channels], ['MCP servers', d.mcpServers], ['Hooks', d.hooks], ['Commands', d.cliCommands],
          ['Other registrations', contracts], ['Settings it marks dangerous', d.dangerousConfigFlags]].filter(([, v]) => Array.isArray(v) && v.length).map(([l, v]) => ({ label: l, items: v.map(String) }));
        const missing = ((i && i.credentials) || []).filter(c => c.status !== 'configured' && c.required).map(c => c.label);
        if (missing.length) details.push({ label: 'Needs credentials (set them in Settings)', items: missing });
        token = i && i.reviewToken;
      }
      if (!await ctx.confirm({ title: `${on ? 'Switch on' : 'Switch off'} ${p.name || p.id}`, rows: [{ label: p.id, from: on ? 'off' : 'on', to: on ? 'on' : 'off' }], details, yes: on ? 'Switch on' : 'Switch off',
        note: on ? (details.length ? 'What it declares: switching it on agrees to exactly this.' : 'It declares no tools, providers, channels or hooks.') : 'Its tools leave every agent.' })) return;
      let restart = false;
      if (await act(ctx, b, async () => { const r = await ctx.call('plugins.setEnabled', { pluginId: p.id, enabled: on, ...(on && token ? { acknowledgeCapabilities: { reviewToken: token } } : {}) }); restart = !!(r && r.restartRequired); }, null)) {
        ctx.toast(`${p.name || p.id}: ${on ? 'on' : 'off'}${restart ? ' - it takes effect when the gateway restarts' : ''}`, 'good');
        render('tools', el, ctx);
      }
    },
  });
}

// ------------------------------------------------------------------ Skills
async function skills(el, ctx) {
  const r = await ctx.call('skills.status');
  const list = (r.skills || []).slice().sort((a, b) => (b.eligible - a.eligible) || String(a.name).localeCompare(b.name));
  const draw = q => {
    const t = (q || '').toLowerCase();
    el.querySelector('.op-list').innerHTML = list.filter(s => !t || `${s.name} ${s.description}`.toLowerCase().includes(t)).map(s => {
      const missing = s.missing ? [...(s.missing.bins || []), ...(s.missing.anyBins || []), ...(s.missing.env || []), ...(s.missing.config || []), ...(s.missing.os || [])] : [];
      const state = s.disabled ? 'Off' : s.eligible ? 'Ready' : missing.length ? `Needs ${missing.slice(0, 3).join(', ')}` : s.blockedByAllowlist ? 'Not allowed' : 'Not ready';
      return `<div class="op-row" data-key="${esc(s.skillKey || s.name)}"><span class="ap-av" aria-hidden="true">${esc(s.emoji || '🧩')}</span>
        <span class="op-main"><b>${esc(s.name)}</b> <span class="tag${s.eligible && !s.disabled ? ' set' : ''}">${esc(state)}</span><small>${esc(s.description || '')}</small></span>
        <span class="op-acts"><label class="check"><input type="checkbox" data-do="toggle"${s.disabled ? '' : ' checked'}> On</label></span></div>`;
    }).join('') || '<p class="hint">No skills match.</p>';
  };
  el.innerHTML = `<input type="search" class="input op-search" placeholder="Search ${list.length} skills"><div class="op-list"></div>`;
  draw('');
  el.querySelector('.op-search').oninput = e => draw(e.target.value);
  el.onchange = async e => {
    const c = e.target.closest('[data-do="toggle"]'); if (!c) return;
    const key = c.closest('.op-row').dataset.key, on = c.checked;
    if (!await ctx.confirm({ title: `${on ? 'Switch on' : 'Switch off'} a skill`, rows: [{ label: key, from: on ? 'off' : 'on', to: on ? 'on' : 'off' }] })) { c.checked = !on; return; }
    if (!await act(ctx, null, () => ctx.call('skills.update', { skillKey: key, enabled: on }), `${key}: ${on ? 'on' : 'off'}`)) c.checked = !on;
    else { const s = list.find(x => (x.skillKey || x.name) === key); if (s) s.disabled = !on; }
  };
}

// ------------------------------------------------------------------ Automations
const scheduleText = s => {
  if (!s) return '';
  if (s.kind === 'every' && Number.isFinite(s.everyMs)) return `every ${span(s.everyMs)}`;
  if (s.kind === 'cron') return `${s.expr}${s.tz ? ` (${s.tz})` : ''}`;
  if (s.kind === 'at') return `once, ${new Date(s.at).toLocaleString()}`;
  return s.kind || '';
};
const managed = new Set();   // automations OpenClaw refused a change to (its own: it says so) - offered no switch again
async function automations(el, ctx) {
  const r = await ctx.call('cron.list', { includeDisabled: true });   // (switched-off ones too: to be switched on again)
  const jobs = r.jobs || [];
  el.innerHTML = `<div class="op-list">${jobs.map(j => `<div class="op-row" data-id="${esc(j.id)}">
      <span class="op-main"><b>${esc(j.displayName || j.name || j.id)}</b> <span class="tag${j.enabled ? ' set' : ''}">${j.enabled ? 'On' : 'Off'}</span>
        <small>${esc(scheduleText(j.schedule))}${j.agentId ? ` · ${esc(j.agentId)}` : ''}${j.nextRunAtMs ? ` · next ${until(j.nextRunAtMs)}` : ''}${j.lastRunAtMs ? ` · last ${ago(j.lastRunAtMs)} (${esc(j.lastRunStatus || '')})` : ''}</small>
        ${j.description ? `<small>${esc(String(j.description).replace(/^\[[^\]]*\]\s*/, ''))}</small>` : ''}${j.lastRunError ? `<small class="op-err">${esc(j.lastRunError)}</small>` : ''}</span>
      <span class="op-acts">${managed.has(j.id) ? '<span class="tag" title="OpenClaw keeps this automation itself">Managed by OpenClaw</span>' : `<button type="button" class="btn small" data-do="toggle">${j.enabled ? 'Switch off' : 'Switch on'}</button>`}<button type="button" class="btn small" data-do="run">Run now</button>
        ${j.declarationKey ? '' : '<button type="button" class="btn small danger" data-do="remove">Remove</button>'}</span></div>`).join('') || '<p class="hint">No automations.</p>'}</div>
    <p class="hint">Automations made by OpenClaw itself (heartbeats, memory) can be switched off but not removed.</p>`;
  const job = b => jobs.find(j => j.id === b.closest('.op-row').dataset.id);
  wire(el, {
    toggle: async b => {
      const j = job(b);
      if (!await ctx.confirm({ title: `${j.enabled ? 'Switch off' : 'Switch on'} an automation`, rows: [{ label: j.displayName || j.name, from: j.enabled ? 'on' : 'off', to: j.enabled ? 'off' : 'on' }] })) return;
      const ok = await act(ctx, b, async () => {
        const send = rev => ctx.call('cron.update', { id: j.id, patch: { enabled: !j.enabled }, ...(rev ? { expectedConfigRevision: rev } : {}) });
        try { await send(j.configRevision); }
        catch (e) {
          if (/system-owned|cannot be edited/i.test(e.message)) managed.add(j.id);
          // (its definition moved on since the list was read - a change just made: read again and send the same change once more)
          if (/no longer matches/i.test(e.message)) { const now = ((await ctx.call('cron.list', { includeDisabled: true })).jobs || []).find(x => x.id === j.id); if (now && now.enabled === j.enabled) { await send(now.configRevision); return; } }
          throw e;
        }
      }, 'Saved');
      render('automations', el, ctx);
      void ok;
    },
    run: async b => { const j = job(b); if (await act(ctx, b, () => ctx.call('cron.run', { id: j.id, mode: 'force' }), `${j.displayName || j.name}: started`)) setTimeout(() => render('automations', el, ctx), 1500); },
    remove: async b => {
      const j = job(b);
      if (!await ctx.confirm({ title: 'Remove an automation?', rows: [{ label: j.displayName || j.name, from: scheduleText(j.schedule), to: 'removed' }], danger: true })) return;
      if (await act(ctx, b, () => ctx.call('cron.remove', { id: j.id }), 'Removed')) render('automations', el, ctx);
    },
  });
}

// ------------------------------------------------------------------ Approvals
const POLICY = { security: { label: 'Commands allowed', options: { deny: 'None', allowlist: 'Only the allowed ones', full: 'All' } },
  ask: { label: 'Ask first', options: { off: 'Never', 'on-miss': 'When not on the allowed list', always: 'Every time' } },
  askFallback: { label: 'When nobody answers', options: { deny: 'Deny', allowlist: 'Allow only the allowed ones', full: 'Allow' } } };
async function approvals(el, ctx) {
  const [pending, pol, grants] = await Promise.all([ctx.call('exec.approval.list'), ctx.call('exec.approvals.get'), ctx.call('exec.approval.grants.list').catch(() => null)]);
  const list = Array.isArray(pending) ? pending : (pending && pending.approvals) || [];
  const gl = Array.isArray(grants) ? grants : (grants && grants.grants) || [];
  const cur = { ...(pol.resolvedDefaults || {}), ...((pol.file && pol.file.defaults) || {}) };
  el.innerHTML = `<h4 class="ap-h">Waiting now</h4><div class="op-list">${list.map(a => { const r = a.request || {};
    return `<div class="op-row" data-id="${esc(a.id)}"><span class="op-main"><b>${esc(r.agentId || 'An agent')} wants to run</b><code class="cw-appr-cmd">${esc(r.command || '')}</code><small>${esc(r.cwd || '')}${a.createdAtMs ? ` · ${ago(a.createdAtMs)}` : ''}</small></span>
      <span class="op-acts">${(r.allowedDecisions || ['allow-once', 'deny']).map(d => `<button type="button" class="btn small${d === 'deny' ? ' danger' : d === 'allow-once' ? ' primary' : ''}" data-do="answer" data-d="${esc(d)}">${esc({ 'allow-once': 'Allow once', 'allow-always': 'Always allow', deny: 'Deny' }[d] || d)}</button>`).join('')}</span></div>`; }).join('') || '<p class="hint">Nothing is waiting.</p>'}</div>
    <h4 class="ap-h">Commands on the gateway's machine</h4>
    <form class="op-policy">${Object.entries(POLICY).map(([k, p]) => `<label>${esc(p.label)}<select class="input" data-k="${k}">${Object.entries(p.options).map(([v, l]) => `<option value="${v}"${cur[k] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`).join('')}
      <div class="row"><button class="btn primary" type="submit">Save</button></div></form>
    <p class="hint">The gateway's own settings may ask more often (Settings → Tools → exec): the stricter one wins.</p>
    ${gl.length ? `<h4 class="ap-h">Always allowed</h4><div class="op-list">${gl.map(g => `<div class="op-row" data-id="${esc(g.id || g.grantId)}"><span class="op-main"><b>${esc(g.command || g.pattern || g.id)}</b><small>${esc(g.agentId || '')}${g.expiresAtMs ? ` · until ${new Date(g.expiresAtMs).toLocaleDateString()}` : ''}</small></span>
      <span class="op-acts"><button type="button" class="btn small danger" data-do="revoke">Revoke</button></span></div>`).join('')}</div>` : ''}`;
  wire(el, {
    answer: async b => { const id = b.closest('.op-row').dataset.id; if (await act(ctx, b, () => ctx.call('exec.approval.resolve', { id, decision: b.dataset.d }), 'Answered')) render('approvals', el, ctx); },
    revoke: async b => {
      const id = b.closest('.op-row').dataset.id;
      if (!await ctx.confirm({ title: 'Revoke a standing permission?', rows: [{ label: id, from: 'always allowed', to: 'asks again' }] })) return;
      if (await act(ctx, b, () => ctx.call('exec.approval.grants.revoke', { id }), 'Revoked')) render('approvals', el, ctx);
    },
  });
  el.querySelector('.op-policy').onsubmit = async e => {
    e.preventDefault();
    const next = Object.fromEntries([...el.querySelectorAll('.op-policy select')].map(s => [s.dataset.k, s.value]));
    const rows = Object.entries(next).filter(([k, v]) => v !== cur[k]).map(([k, v]) => ({ label: POLICY[k].label, from: POLICY[k].options[cur[k]] || cur[k] || '(default)', to: POLICY[k].options[v] }));
    if (!rows.length) return ctx.toast('Nothing changed');
    if (!await ctx.confirm({ title: 'Change how commands are approved', rows })) return;
    const file = { ...(pol.file || { version: 1 }), version: 1, defaults: { ...((pol.file && pol.file.defaults) || {}), ...next } };
    delete file.socket;
    if (await act(ctx, e.submitter, () => ctx.call('exec.approvals.set', { file, baseHash: pol.hash }), 'Saved')) render('approvals', el, ctx);
  };
}

// ------------------------------------------------------------------ Sessions
async function sessions(el, ctx) {
  const r = await ctx.call('sessions.list', { limit: 100, includeDerivedTitles: true, includeLastMessage: true });
  const list = r.sessions || [];
  el.innerHTML = `<div class="op-list">${list.map(s => `<div class="op-row" data-key="${esc(s.key)}"><span class="op-main"><b>${esc(s.label || s.displayName || s.derivedTitle || s.key)}</b>${s.hasActiveRun ? ' <span class="tag set">Working</span>' : ''}
      <small>${esc(s.agentId || '')} · ${esc(s.classification || s.kind || '')}${s.model ? ` · ${esc(s.model)}` : ''}${Number.isFinite(s.totalTokens) && s.contextTokens ? ` · ${Math.round(100 * s.totalTokens / s.contextTokens)}% context` : ''}${s.updatedAt ? ` · ${ago(s.updatedAt)}` : ''}</small></span>
      <span class="op-acts"><button type="button" class="btn small" data-do="chat">💬 Open</button>${s.isMain ? '' : '<button type="button" class="btn small danger" data-do="del">Delete</button>'}</span></div>`).join('') || '<p class="hint">No sessions.</p>'}</div>`;
  const row = b => list.find(s => s.key === b.closest('.op-row').dataset.key);
  wire(el, {
    chat: b => { const s = row(b); ctx.openChat(s.agentId, s.key); },
    del: async b => {
      const s = row(b);
      if (!await ctx.confirm({ title: 'Delete a session?', rows: [{ label: s.label || s.derivedTitle || s.key, from: 'kept', to: 'deleted, with its history' }], danger: true })) return;
      if (await act(ctx, b, () => ctx.call('sessions.delete', { key: s.key, agentId: s.agentId }), 'Deleted')) render('sessions', el, ctx);
    },
  });
}

// ------------------------------------------------------------------ Settings (drawn from OpenClaw's own description)
const at = (o, path) => path.split('.').reduce((v, k) => (v === undefined || v === null ? undefined : v[k]), o);
function nest(path, value) { return path.split('.').reduceRight((v, k) => ({ [k]: v }), value); }
function merge(a, b) { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], v) : v; return a; }
async function settings(el, ctx) {
  const [outline, cfg] = await Promise.all([ctx.call('settings.outline'), ctx.call('config.get')]);
  const S = { cfg, path: null, crumbs: [], pending: new Map(), advanced: false, outline };
  el.innerHTML = `<div class="op-set"><nav class="op-secs"></nav><section class="op-pane"><p class="hint">Choose a section. Every change is shown to you before it is saved.</p></section></div>
    <div class="op-savebar hidden"><span class="op-n"></span><button type="button" class="btn" data-do="discard">Discard</button><button type="button" class="btn primary" data-do="review">Review and save</button></div>`;
  const groups = [];
  for (const s of outline.sections) { let g = groups.find(x => x.name === s.group); if (!g) groups.push(g = { name: s.group, list: [] }); g.list.push(s); }
  el.querySelector('.op-secs').innerHTML = groups.map(g => `<div class="op-g">${g.list.map(s => `<button type="button" class="op-sec" data-do="sec" data-path="${esc(s.key)}" title="${esc(s.help)}">${esc(s.label)}</button>`).join('')}</div>`).join('');
  const paintBar = () => {
    el.querySelector('.op-savebar').classList.toggle('hidden', !S.pending.size);
    el.querySelector('.op-n').textContent = `${S.pending.size} change${S.pending.size === 1 ? '' : 's'} not saved`;
  };
  const open = async path => {
    S.path = path;
    for (const b of el.querySelectorAll('.op-sec')) b.classList.toggle('on', path === b.dataset.path || path.startsWith(`${b.dataset.path}.`));
    const pane = el.querySelector('.op-pane');
    pane.innerHTML = '<p class="hint">Loading…</p>';
    const node = await ctx.call('config.schema.lookup', { path });
    const kids = node.children || [];
    const leaves = kids.map(() => null);
    const parts = path.split('.');
    pane.innerHTML = `<div class="op-crumbs">${parts.map((p, i) => `<button type="button" class="btn link small" data-do="crumb" data-path="${esc(parts.slice(0, i + 1).join('.'))}">${esc(i === parts.length - 1 && node.hint && node.hint.label ? node.hint.label : i === 0 ? (S.outline.sections.find(x => x.key === p) || {}).label || words(p) : words(p))}</button>`).join(' › ')}</div>
      ${node.hint && node.hint.help ? `<p class="hint">${esc(node.hint.help)}</p>` : node.schema && node.schema.description ? `<p class="hint">${esc(node.schema.description)}</p>` : ''}
      ${node.hint && node.hint.docsUrl ? `<p class="hint"><a href="${esc(node.hint.docsUrl)}" target="_blank" rel="noopener noreferrer">OpenClaw's documentation ↗</a></p>` : ''}
      <label class="check op-adv"><input type="checkbox" data-do="adv"${S.advanced ? ' checked' : ''}> Show advanced settings</label>
      <div class="op-fields">${kids.map((k, i) => fieldHtml(k, leaves[i], S)).join('') || '<p class="hint">Nothing to set here.</p>'}</div>`;
    pane.querySelectorAll('.op-field.adv').forEach(f => f.classList.toggle('hidden', !S.advanced));
    // then each plain field's own description (its choices, bounds, default), a few at a time as the gateway paces its
    // control calls (a busy one is asked again); a field nobody changed yet is drawn again with it
    const needs = k => !(k.hint && k.hint.sensitive) && !k.hasChildren && (!k.type || k.type === 'string' || k.type === 'number' || k.type === 'integer');
    const here = path;
    pooled(kids.map(k => async () => {
      if (!needs(k)) return;
      const leaf = await lookup(ctx, k.path).catch(() => null);
      if (!leaf || S.path !== here || S.pending.has(k.path)) return;
      const old = pane.querySelector(`.op-field[data-field="${CSS.escape(k.path)}"]`);
      if (!old || old.contains(document.activeElement)) return;
      const fresh = h(fieldHtml(k, leaf, S));
      if (fresh.classList.contains('adv') && !S.advanced) fresh.classList.add('hidden');
      old.replaceWith(fresh);
    }), 4);
  };
  wire(el, {
    sec: b => open(b.dataset.path), crumb: b => open(b.dataset.path), into: b => open(b.dataset.path),
    adv: c => { S.advanced = c.checked; el.querySelectorAll('.op-field.adv').forEach(f => f.classList.toggle('hidden', !S.advanced)); },
    discard: () => { S.pending.clear(); paintBar(); if (S.path) open(S.path); },
    review: async b => {
      const rows = [...S.pending].map(([p, x]) => ({ label: x.label ? `${x.label} (${p})` : p, from: shown(at(S.cfg.config, p)), to: x.secret ? '•••••• (new)' : shown(x.value), restart: x.reload === 'restart' }));
      const restart = rows.some(r => r.restart);
      if (!await ctx.confirm({ title: 'Save these settings to OpenClaw', rows, note: restart ? 'Some of these take effect when the gateway restarts.' : 'They take effect at once.' })) return;
      const patch = {}, replace = [];
      for (const [p, x] of S.pending) { merge(patch, nest(p, x.value)); if (Array.isArray(x.value)) replace.push(p); }
      let stale = false;
      const ok = await act(ctx, b, async () => {
        try { await ctx.call('config.patch', { raw: JSON.stringify(patch), baseHash: S.cfg.hash, note: 'My Virtual World', ...(replace.length ? { replacePaths: replace } : {}) }); }
        catch (e) { if (/changed since/i.test(e.message)) { stale = true; throw new Error('OpenClaw\'s settings were changed elsewhere meanwhile: they are read again - check your changes and save again.'); } throw e; }
      }, 'Saved to OpenClaw');
      S.cfg = await ctx.call('config.get').catch(() => S.cfg);
      if (ok) S.pending.clear();
      paintBar(); if (S.path && (ok || stale)) open(S.path);
    },
  });
  // a field changed: kept as a change to review (never sent before the person's OK)
  el.oninput = el.onchange = e => {
    const f = e.target.closest('[data-field]'); if (!f || e.target.matches('[data-do="adv"]')) return;
    const p = f.dataset.field, kind = f.dataset.kind, inp = e.target;
    let v;
    if (kind === 'boolean') v = inp.checked;
    else if (kind === 'number' || kind === 'integer') { if (inp.value === '') { S.pending.delete(p); paintBar(); return; } v = Number(inp.value); if (!Number.isFinite(v)) return; }
    else if (kind === 'json') { try { v = JSON.parse(inp.value); inp.classList.remove('bad'); } catch { inp.classList.add('bad'); return; } }
    else v = inp.value;
    if (f.dataset.secret && v === '') { S.pending.delete(p); paintBar(); return; }
    S.pending.set(p, { value: v, label: f.dataset.label, reload: f.dataset.reload, secret: !!f.dataset.secret });
    paintBar();
  };
}
/** Runs the tasks `n` at a time; each resolves to its value (null when it failed). */
async function pooled(tasks, n) {
  const out = new Array(tasks.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => { while (next < tasks.length) { const i = next++; try { out[i] = await tasks[i](); } catch { out[i] = null; } } }));
  return out;
}
/** One setting's description (a busy gateway is asked again by ctx.call). */
const lookup = (ctx, path) => ctx.call('config.schema.lookup', { path });
/** A setting's key in words where OpenClaw gives it no label: "imageModel" → "Image model". */
const words = key => String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase()).replace(/ (\w)/g, (m, c) => ` ${c.toLowerCase()}`);
function fieldHtml(k, leaf, S) {
  const hint = k.hint || {}, label = hint.label || words(k.key), help = hint.help || (leaf && leaf.schema && leaf.schema.description) || '';
  const adv = hint.advanced ? ' adv' : '';
  // (a secret is a field however OpenClaw shapes it - a value, or a reference to its secret store)
  if (k.hasChildren && !hint.sensitive) return `<div class="op-field op-sub${adv}"><button type="button" class="op-into" data-do="into" data-path="${esc(k.path)}"><span class="op-fl"><b>${esc(label)}</b>${help ? `<small>${esc(help)}</small>` : ''}</span><span class="op-go" aria-hidden="true">›</span></button></div>`;
  const sc = (leaf && leaf.schema) || {}, cur = S.pending.has(k.path) ? S.pending.get(k.path).value : at(S.cfg.config, k.path);
  const secret = hint.sensitive || (cur && typeof cur === 'object' && cur.secret);
  const choices = choicesOf(sc);
  const type = choices ? 'enum' : sc.type === 'boolean' || k.type === 'boolean' ? 'boolean' : ['number', 'integer'].includes(sc.type || k.type) ? (sc.type || k.type) : ['array', 'object'].includes(sc.type || k.type) ? 'json' : 'string';
  const attrs = `data-field="${esc(k.path)}" data-kind="${type}" data-label="${esc(label)}" data-reload="${esc(leaf && leaf.reloadKind || k.reloadKind || '')}"${secret ? ' data-secret="1"' : ''}`;
  const restart = (leaf && leaf.reloadKind || k.reloadKind) === 'restart' ? ' <span class="tag" title="Takes effect when the gateway restarts">restart</span>' : '';
  const head = `<span class="op-fl"><b>${esc(label)}</b>${restart}${help ? `<small>${esc(help)}</small>` : ''}</span>`;
  let input;
  if (secret) input = `<input class="input" type="password" autocomplete="new-password" placeholder="${cur && cur.set ? 'Set - type a new value to change it' : 'Not set'}">`;
  else if (type === 'boolean') input = `<label class="check"><input type="checkbox"${cur === true || (cur === undefined && sc.default === true) ? ' checked' : ''}> ${cur === undefined ? '(default)' : ''}</label>`;
  else if (type === 'enum') input = `<select class="input">${cur === undefined ? '<option value="" selected>(default)</option>' : ''}${choices.map(v => `<option value="${esc(String(v))}"${String(cur) === String(v) ? ' selected' : ''}>${esc(String(v))}</option>`).join('')}</select>`;
  else if (type === 'number' || type === 'integer') input = `<input class="input" type="number"${Number.isFinite(sc.minimum) ? ` min="${sc.minimum}"` : ''}${Number.isFinite(sc.maximum) ? ` max="${sc.maximum}"` : ''} value="${cur === undefined ? '' : esc(String(cur))}" placeholder="${sc.default !== undefined ? esc(String(sc.default)) : '(default)'}">`;
  else if (type === 'json') input = `<textarea class="input op-json" rows="3" spellcheck="false" placeholder="(default)">${cur === undefined ? '' : esc(JSON.stringify(cur, null, 2))}</textarea>`;
  else input = `<input class="input" type="text" value="${cur === undefined ? '' : esc(String(cur))}" placeholder="${esc(hint.placeholder || (sc.default !== undefined ? String(sc.default) : '(default)'))}">`;
  return `<div class="op-field${adv}" ${attrs}>${head}${input}</div>`;
}
export { h };
