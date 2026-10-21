// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Hermes' sub-menu in Agent Providers (docs/features/agent-providers.md §9): its backend, its agents (profiles), models,
// tools, skills, automations, MCP servers, sessions and every setting it has — what Hermes' own dashboard and Desktop
// settings offer, through its backend. Every call goes through the server (POST /api/agent-providers/call: the
// connection's managers only, a fixed list of calls, no secret's value ever comes back); every change is shown first —
// what it changes, from what to what — and waits for the person's OK. The Settings page is drawn from Hermes' own
// description of its settings (/api/config/schema), so a newer Hermes' settings show by themselves.
import { esc } from '../../core/util.js';

export const TABS = Object.freeze([
  { id: 'overview', label: 'Overview', icon: '📊' }, { id: 'agents', label: 'Agents', icon: '🤖' }, { id: 'models', label: 'Models', icon: '🧠' },
  { id: 'tools', label: 'Tools', icon: '🔧' }, { id: 'skills', label: 'Skills', icon: '🧩' }, { id: 'automations', label: 'Automations', icon: '⏰' },
  { id: 'mcp', label: 'MCP servers', icon: '🔌' }, { id: 'sessions', label: 'Sessions', icon: '💬' }, { id: 'settings', label: 'Settings', icon: '⚙️' },
]);
const PAGES = { overview, agents, models, tools, skills, automations, mcp, sessions, settings };

/** Draws page `tab` into `el`. ctx: { call(method, params), confirm({ title, rows, details, note, yes }), toast(text, kind), openChat(nativeId, sessionKey) }. */
export async function render(tab, el, ctx) {
  el.innerHTML = '<p class="hint">Loading…</p>';
  try { await PAGES[tab](el, ctx); }
  catch (e) { el.innerHTML = `<div class="ap-card bad"><h4>Could not read it</h4><p>${esc(e.message)}</p></div>`; }
}

// ------------------------------------------------------------------ small helpers
const ago = ms => { if (!Number.isFinite(ms)) return ''; const s = Math.round((Date.now() - ms) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`; };
const secs = v => (Number.isFinite(v) ? Math.round(v * 1000) : typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : NaN);
const mb = n => (Number.isFinite(n) ? (n > 10240 ? `${(n / 1024).toFixed(1)} GB` : `${Math.round(n)} MB`) : '');
const kv = (k, v) => (v === undefined || v === null || v === '' ? '' : `<div class="kv2"><span>${esc(k)}</span><b>${esc(String(v))}</b></div>`);
const shown = v => (v && typeof v === 'object' && v.secret ? (v.set ? '•••••• (set)' : '(not set)') : v === undefined || v === null ? '(not set)' : typeof v === 'string' ? (v === '' ? '(empty)' : v) : JSON.stringify(v));
const words = key => String(key).replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase());
function wire(el, map) { el.onclick = e => { const b = e.target.closest('[data-do]'); if (b && map[b.dataset.do]) map[b.dataset.do](b, e); }; }
async function act(ctx, b, fn, done = 'Done') {
  if (b) b.disabled = true;
  try { await fn(); if (done) ctx.toast(done, 'good'); return true; }
  catch (e) { ctx.toast(e.message, 'bad'); return false; }
  finally { if (b) b.disabled = false; }
}
/** The agents (profiles) and which one a page shows: every page that is about one profile has a picker. */
const PICKED = new WeakMap();
async function withProfile(el, ctx) {
  const r = await ctx.call('profiles.list');
  const list = (r.profiles || []).filter(p => p && p.name && p.role !== 'setup');
  const name = list.some(p => p.name === PICKED.get(el)) ? PICKED.get(el) : ((list.find(p => p.is_default) || list[0] || {}).name || 'default');
  return { list, name, picker: list.length > 1 ? `<label class="op-pick">Agent <select class="input op-agent">${list.map(p => `<option value="${esc(p.name)}"${p.name === name ? ' selected' : ''}>${esc(p.display_name || p.name)}</option>`).join('')}</select></label>` : '' };
}
function pickable(el, ctx, tab) { const s = el.querySelector('.op-agent'); if (s) s.onchange = () => { PICKED.set(el, s.value); render(tab, el, ctx); }; }

// ------------------------------------------------------------------ Overview
async function overview(el, ctx) {
  const [st, an] = await Promise.all([ctx.call('status'), ctx.call('analytics', { days: 30 }).catch(() => null)]);
  const c = st.components || {}, m = st.memory || {}, d = st.disk || {};
  const tot = an && (an.totals || an.summary) || null;
  el.innerHTML = `<div class="op-grid">
    <div class="ap-card"><h4>🤖 Hermes</h4>${kv('Version', st.version)}${kv('Released', st.release_date)}${kv('Overall', st.overall)}${kv('Sign-in', st.auth_required ? 'Engaged (username and password, or OAuth)' : 'This machine only (session token)')}
      ${kv('Agents', Array.isArray(st.profiles) ? st.profiles.length : '')}${st.can_update_hermes && st.update_available ? '<p class="hint">An update is available: run <code>hermes update</code> on Hermes\' machine. My Virtual World reconnects by itself afterwards.</p>' : ''}</div>
    <div class="ap-card"><h4>📡 Messaging gateway</h4>${kv('Running', st.gateway_running ? 'Yes' : 'No')}${kv('State', st.gateway_state)}${kv('Mode', st.gateway_mode)}${kv('Agents at work', st.active_agents)}
      ${kv('Channels', c.platforms ? `${c.platforms.connected ?? 0} of ${c.platforms.configured ?? 0} connected` : '')}${st.gateway_exit_reason ? `<p class="hint op-err">${esc(st.gateway_exit_reason)}</p>` : ''}</div>
    <div class="ap-card"><h4>🖥️ Machine</h4>${kv('Memory', Number.isFinite(m.system_total_mb) ? `${mb(m.system_total_mb - (m.system_available_mb || 0))} of ${mb(m.system_total_mb)} in use` : m.pressure)}
      ${kv('Disk', Number.isFinite(d.total_mb) ? `${mb(d.free_mb)} free of ${mb(d.total_mb)} (${d.pressure})` : '')}${kv('Hermes home', st.hermes_home)}</div>
    ${tot ? `<div class="ap-card"><h4>📈 Last 30 days</h4>${kv('Sessions', tot.sessions ?? tot.session_count)}${kv('Input tokens', tot.input_tokens)}${kv('Output tokens', tot.output_tokens)}${kv('Cost', Number.isFinite(tot.cost ?? tot.estimated_cost_usd) ? `$${(tot.cost ?? tot.estimated_cost_usd).toFixed(2)}` : '')}</div>` : ''}
  </div>`;
}

// ------------------------------------------------------------------ Agents (Hermes profiles)
async function agents(el, ctx) {
  const r = await ctx.call('profiles.list');
  const list = (r.profiles || []).filter(p => p && p.name && p.role !== 'setup');
  el.innerHTML = `<p class="hint">Each Hermes profile is an agent: its own personality (SOUL), memory, skills and model.</p>
    <div class="op-list">${list.map(p => `<div class="op-row" data-name="${esc(p.name)}"><span class="ap-av" aria-hidden="true">🤖</span>
      <span class="op-main"><b>${esc(p.display_name || p.name)}</b>${p.is_default ? ' <span class="tag">Default</span>' : ''}<small>${esc(p.name)}${p.model ? ` · ${esc(p.model)}` : ''}${Number.isFinite(p.skill_count) ? ` · ${p.skill_count} skills` : ''}</small>
        ${p.description ? `<small>${esc(p.description)}</small>` : ''}</span>
      <span class="op-acts"><button type="button" class="btn small" data-do="chat">💬 Chat</button><button type="button" class="btn small" data-do="soul">Personality</button></span>
      <div class="op-soul hidden"></div></div>`).join('') || '<p class="hint">No profiles.</p>'}</div>
    <h4 class="ap-h">New agent</h4>
    <form class="op-form row wrap"><input class="input op-name" maxlength="64" pattern="[A-Za-z0-9_-]+" placeholder="Name (letters, digits, - and _)" required>
      <input class="input op-desc" maxlength="200" placeholder="What it is for (optional)"><select class="input op-clone"><option value="">Start fresh</option>${list.map(p => `<option value="${esc(p.name)}">Copy the settings of ${esc(p.display_name || p.name)}</option>`).join('')}</select>
      <button class="btn primary" type="submit">Create</button></form>`;
  const name = b => b.closest('.op-row').dataset.name;
  wire(el, {
    chat: b => ctx.openChat(name(b)),
    soul: async b => {
      const box = b.closest('.op-row').querySelector('.op-soul');
      if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
      box.innerHTML = '<p class="hint">Loading…</p>'; box.classList.remove('hidden');
      try {
        const d = await ctx.call('profiles.describe', { name: name(b) });
        box.innerHTML = `${kv('Model', d.model && d.model.default ? `${d.model.default}${d.model.provider ? ` (${d.model.provider})` : ''}` : '(Hermes\' default)')}
          ${d.soul ? `<pre class="op-pre">${esc(d.soul)}</pre>` : '<p class="hint">No SOUL.md: it uses Hermes\' own personality.</p>'}
          ${kv('Skills on', Array.isArray(d.skills) ? d.skills.filter(s => s.enabled !== false).length : '')}${kv('Toolsets on', Array.isArray(d.toolsets) ? d.toolsets.filter(t => t.enabled !== false).map(t => t.label || t.name).join(', ') : '')}
          <p class="hint">Its personality is edited in Hermes (its SOUL.md, or Hermes Desktop → Profiles).</p>`;
      } catch (e) { box.innerHTML = `<p class="hint op-err">${esc(e.message)}</p>`; }
    },
  });
  el.querySelector('.op-form').onsubmit = async e => {
    e.preventDefault();
    const n = el.querySelector('.op-name').value.trim(), description = el.querySelector('.op-desc').value.trim(), clone = el.querySelector('.op-clone').value;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(n)) return ctx.toast('A name of letters, digits, - and _', 'bad');
    if (!await ctx.confirm({ title: 'Create an agent', rows: [{ label: 'Hermes profile', from: '', to: n }, ...(description ? [{ label: 'Description', from: '', to: description }] : []), { label: 'Settings', from: '', to: clone ? `copied from ${clone}` : 'fresh' }],
      note: 'Hermes makes a new profile with its own home folder; it joins the chat window and the city as an agent.' })) return;
    if (await act(ctx, e.submitter, () => ctx.call('profiles.create', { name: n, ...(description ? { description } : {}), ...(clone ? { clone_from: clone } : {}) }), `Created ${n}`)) render('agents', el, ctx);
  };
}

// ------------------------------------------------------------------ Models
async function models(el, ctx) {
  const P = await withProfile(el, ctx);
  const r = await ctx.call('models.options', { profile: P.name });
  const provs = (r.providers || []).filter(p => p && (p.authenticated !== false || p.is_current));
  el.innerHTML = `${P.picker}<div class="ap-card"><h4>In use</h4>${kv('Model', r.model)}${kv('Provider', r.provider)}<p class="hint">New chats of this agent use it; a chat may choose another in the chat window (for that chat only).</p></div>
    <input type="search" class="input op-search" placeholder="Search models"><div class="op-models"></div>
    <p class="hint">Sign in to more model providers in Hermes (<code>hermes model</code>, or its dashboard → Models).</p>`;
  const draw = q => {
    const t = (q || '').toLowerCase();
    el.querySelector('.op-models').innerHTML = provs.map(p => {
      const ms = (p.models || []).filter(m => !t || `${m} ${p.name}`.toLowerCase().includes(t));
      if (!ms.length) return '';
      return `<details class="op-tgroup"${t || p.is_current ? ' open' : ''}><summary><b>${esc(p.name || p.slug)}</b> <small>${ms.length}${p.is_current ? ' · in use' : ''}</small></summary><div class="op-list">${ms.slice(0, 200).map(m => {
        const cur = p.slug === r.provider && m === r.model, cap = (p.capabilities && p.capabilities[m]) || {}, price = p.pricing && p.pricing[m];
        return `<div class="op-row" data-p="${esc(p.slug)}" data-m="${esc(m)}"><span class="op-main"><b>${esc(m)}</b>${cur ? ' <span class="tag set">Default</span>' : ''}<small>${cap.reasoning ? 'reasons' : ''}${price ? `${cap.reasoning ? ' · ' : ''}${price.free ? 'free' : `${esc(price.input)} in / ${esc(price.output)} out`}` : ''}</small></span>
          <span class="op-acts">${cur ? '' : '<button type="button" class="btn small" data-do="default">Make default</button>'}</span></div>`;
      }).join('')}</div></details>`;
    }).join('') || '<p class="hint">No models match.</p>';
  };
  draw('');
  el.querySelector('.op-search').oninput = e => draw(e.target.value);
  pickable(el, ctx, 'models');
  wire(el, {
    default: async b => {
      const row = b.closest('.op-row'), provider = row.dataset.p, model = row.dataset.m;
      if (!await ctx.confirm({ title: `Change ${P.name}'s default model`, rows: [{ label: 'Model', from: `${r.model || '(none)'}${r.provider ? ` (${r.provider})` : ''}`, to: `${model} (${provider})` }], note: 'New chats use it; chats already open keep theirs.' })) return;
      await act(ctx, b, async () => {
        let x = await ctx.call('model.default', { profile: P.name, provider, model });
        if (x && x.confirm_required) {
          if (!await ctx.confirm({ title: 'Hermes asks to confirm', rows: [{ label: 'Model', from: '', to: model }], note: x.confirm_message || 'This model is expensive.' })) throw new Error('Not changed');
          x = await ctx.call('model.default', { profile: P.name, provider, model, confirm: true });
        }
      }, 'Default model changed') && render('models', el, ctx);
    },
  });
}

// ------------------------------------------------------------------ Tools (toolsets)
async function tools(el, ctx) {
  const P = await withProfile(el, ctx);
  const list = await ctx.call('toolsets.list', { profile: P.name });
  el.innerHTML = `${P.picker}<p class="hint">Hermes' toolsets for this agent: switching one off takes its tools away from new sessions.</p><div class="op-list">${(list || []).map(t => `<div class="op-row" data-name="${esc(t.name)}">
      <span class="op-main"><b>${esc(t.label || t.name)}</b> <span class="tag${t.enabled ? ' set' : ''}">${t.enabled ? 'On' : 'Off'}</span>${t.available === false ? ' <span class="tag warn">Not available</span>' : t.configured === false ? ' <span class="tag warn">Needs setup</span>' : ''}
        <small>${esc(t.description || '')}</small>${Array.isArray(t.tools) && t.tools.length ? `<small>${esc(t.tools.slice(0, 14).join(', '))}${t.tools.length > 14 ? ` +${t.tools.length - 14}` : ''}</small>` : ''}</span>
      <span class="op-acts"><button type="button" class="btn small" data-do="toggle" data-on="${t.enabled ? '1' : ''}">${t.enabled ? 'Switch off' : 'Switch on'}</button></span></div>`).join('') || '<p class="hint">No toolsets.</p>'}</div>`;
  pickable(el, ctx, 'tools');
  wire(el, {
    toggle: async b => {
      const n = b.closest('.op-row').dataset.name, on = !b.dataset.on;
      if (!await ctx.confirm({ title: `${on ? 'Switch on' : 'Switch off'} a toolset`, rows: [{ label: `${P.name}: ${n}`, from: on ? 'off' : 'on', to: on ? 'on' : 'off' }], note: 'It applies to new sessions.' })) return;
      if (await act(ctx, b, () => ctx.call('toolsets.set', { profile: P.name, name: n, enabled: on }), `${n}: ${on ? 'on' : 'off'}`)) render('tools', el, ctx);
    },
  });
}

// ------------------------------------------------------------------ Skills
async function skills(el, ctx) {
  const P = await withProfile(el, ctx);
  const list = ((await ctx.call('skills.list', { profile: P.name })) || []).slice().sort((a, b) => (b.enabled - a.enabled) || String(a.name).localeCompare(b.name));
  const draw = q => {
    const t = (q || '').toLowerCase();
    el.querySelector('.op-list').innerHTML = list.filter(s => !t || `${s.name} ${s.description} ${s.category}`.toLowerCase().includes(t)).map(s => `<div class="op-row" data-name="${esc(s.name)}"><span class="ap-av" aria-hidden="true">🧩</span>
      <span class="op-main"><b>${esc(s.name)}</b>${s.category ? ` <span class="tag">${esc(s.category)}</span>` : ''}<small>${esc(s.description || '')}</small><small>${esc({ hub: 'From the skills hub', bundled: 'Comes with Hermes', agent: 'Made by the agent or by hand' }[s.provenance] || '')}${s.usage ? ` · used ${s.usage}×` : ''}</small></span>
      <span class="op-acts"><label class="check"><input type="checkbox" data-do="toggle"${s.enabled ? ' checked' : ''}> On</label></span></div>`).join('') || '<p class="hint">No skills match.</p>';
  };
  el.innerHTML = `${P.picker}<input type="search" class="input op-search" placeholder="Search ${list.length} skills"><div class="op-list"></div>`;
  draw('');
  pickable(el, ctx, 'skills');
  el.querySelector('.op-search').oninput = e => draw(e.target.value);
  el.onchange = async e => {
    const c = e.target.closest('[data-do="toggle"]'); if (!c) return;
    const n = c.closest('.op-row').dataset.name, on = c.checked;
    if (!await ctx.confirm({ title: `${on ? 'Switch on' : 'Switch off'} a skill`, rows: [{ label: `${P.name}: ${n}`, from: on ? 'off' : 'on', to: on ? 'on' : 'off' }] })) { c.checked = !on; return; }
    if (!await act(ctx, null, () => ctx.call('skills.set', { profile: P.name, name: n, enabled: on }), `${n}: ${on ? 'on' : 'off'}`)) c.checked = !on;
    else { const s = list.find(x => x.name === n); if (s) s.enabled = on; }
  };
}

// ------------------------------------------------------------------ Automations (Hermes' cron)
async function automations(el, ctx) {
  const P = await withProfile(el, ctx);
  const r = await ctx.call('cron.list', { profile: P.name });
  const jobs = Array.isArray(r) ? r : (r && r.jobs) || [];
  const idOf = j => j.job_id || j.id;
  el.innerHTML = `${P.picker}<div class="op-list">${jobs.map(j => {
    const paused = j.enabled === false || j.state === 'paused' || !!j.paused_at;
    return `<div class="op-row" data-id="${esc(idOf(j))}"><span class="op-main"><b>${esc(j.name || j.prompt_preview || idOf(j))}</b> <span class="tag${paused ? '' : ' set'}">${paused ? 'Paused' : 'On'}</span>
        <small>${esc(j.schedule_display || j.schedule || '')}${j.deliver ? ` · to ${esc(j.deliver)}` : ''}${j.next_run_at && !paused ? ` · next ${esc(new Date(secs(j.next_run_at) || j.next_run_at).toLocaleString())}` : ''}${j.last_run_at ? ` · last ${ago(secs(j.last_run_at))} (${esc(j.last_status || '')})` : ''}</small>
        ${j.prompt_preview ? `<small>${esc(j.prompt_preview)}</small>` : ''}${j.last_error || j.last_fire_error ? `<small class="op-err">${esc(j.last_error || j.last_fire_error)}</small>` : ''}</span>
      <span class="op-acts"><button type="button" class="btn small" data-do="${paused ? 'resume' : 'pause'}">${paused ? 'Resume' : 'Pause'}</button><button type="button" class="btn small" data-do="run">Run now</button>
        <button type="button" class="btn small danger" data-do="remove">Remove</button></span></div>`;
  }).join('') || '<p class="hint">No scheduled jobs.</p>'}</div>
    <p class="hint">New scheduled jobs are made by asking the agent ("every morning at 8, …"), or with <code>hermes cron</code>.</p>`;
  pickable(el, ctx, 'automations');
  const job = b => jobs.find(j => String(idOf(j)) === b.closest('.op-row').dataset.id);
  const name = j => j.name || j.prompt_preview || idOf(j);
  wire(el, {
    pause: async b => { const j = job(b); if (!await ctx.confirm({ title: 'Pause a scheduled job', rows: [{ label: name(j), from: 'on', to: 'paused' }] })) return; if (await act(ctx, b, () => ctx.call('cron.pause', { profile: P.name, id: idOf(j) }), 'Paused')) render('automations', el, ctx); },
    resume: async b => { const j = job(b); if (!await ctx.confirm({ title: 'Resume a scheduled job', rows: [{ label: name(j), from: 'paused', to: 'on' }] })) return; if (await act(ctx, b, () => ctx.call('cron.resume', { profile: P.name, id: idOf(j) }), 'Resumed')) render('automations', el, ctx); },
    run: async b => { const j = job(b); if (!await ctx.confirm({ title: 'Run a scheduled job now', rows: [{ label: name(j), from: '', to: 'runs now' }] })) return; if (await act(ctx, b, () => ctx.call('cron.run', { profile: P.name, id: idOf(j) }), `${name(j)}: started`)) setTimeout(() => render('automations', el, ctx), 1500); },
    remove: async b => { const j = job(b); if (!await ctx.confirm({ title: 'Remove a scheduled job?', rows: [{ label: name(j), from: j.schedule_display || j.schedule || '', to: 'removed' }], danger: true })) return; if (await act(ctx, b, () => ctx.call('cron.remove', { profile: P.name, id: idOf(j) }), 'Removed')) render('automations', el, ctx); },
  });
}

// ------------------------------------------------------------------ MCP servers
async function mcp(el, ctx) {
  const P = await withProfile(el, ctx);
  const r = await ctx.call('mcp.list', { profile: P.name });
  const list = Array.isArray(r) ? r : (r && r.servers) || [];
  el.innerHTML = `${P.picker}<div class="op-list">${list.map(s => `<div class="op-row" data-name="${esc(s.name)}"><span class="op-main"><b>${esc(s.name)}</b> <span class="tag${s.enabled ? ' set' : ''}">${s.enabled ? 'On' : 'Off'}</span>${s.source === 'plugin' ? ` <span class="tag">From ${esc(s.plugin || 'a plugin')}</span>` : ''}
      <small>${esc(s.transport || '')}${s.url ? ` · ${esc(s.url)}` : s.command ? ` · ${esc([s.command, ...(s.args || [])].join(' '))}` : ''}${Array.isArray(s.env) && s.env.length ? ` · needs ${esc(s.env.join(', '))}` : ''}</small></span>
      <span class="op-acts">${s.source === 'plugin' ? '' : `<button type="button" class="btn small" data-do="toggle" data-on="${s.enabled ? '1' : ''}">${s.enabled ? 'Switch off' : 'Switch on'}</button>`}</span></div>`).join('') || '<p class="hint">No MCP servers. Add them in Hermes (<code>hermes mcp add</code>, or its dashboard → MCP).</p>'}</div>`;
  pickable(el, ctx, 'mcp');
  wire(el, {
    toggle: async b => {
      const n = b.closest('.op-row').dataset.name, on = !b.dataset.on;
      if (!await ctx.confirm({ title: `${on ? 'Switch on' : 'Switch off'} an MCP server`, rows: [{ label: `${P.name}: ${n}`, from: on ? 'off' : 'on', to: on ? 'on' : 'off' }], note: 'It applies to new sessions.' })) return;
      if (await act(ctx, b, () => ctx.call('mcp.set', { profile: P.name, name: n, enabled: on }), `${n}: ${on ? 'on' : 'off'}`)) render('mcp', el, ctx);
    },
  });
}

// ------------------------------------------------------------------ Sessions
const SOURCE = { myvirtualworld: 'My Virtual World', desktop: 'Hermes Desktop', tui: 'Terminal', cli: 'Terminal', cron: 'Scheduled job', api_server: 'API', telegram: 'Telegram', discord: 'Discord', slack: 'Slack', whatsapp: 'WhatsApp', signal: 'Signal', email: 'Email', sms: 'SMS' };
async function sessions(el, ctx) {
  const P = await withProfile(el, ctx);
  const r = await ctx.call('sessions.list', { profile: P.name, limit: 100 });
  const list = ((r && r.sessions) || []).filter(s => !s.parent_session_id);
  el.innerHTML = `${P.picker}<div class="op-list">${list.map(s => `<div class="op-row" data-id="${esc(s.id)}"><span class="op-main"><b>${esc(s.title || s.preview || s.id)}</b>${!s.ended_at && s.is_active ? ' <span class="tag set">Active</span>' : ''}
      <small>${esc(SOURCE[s.source] || words(s.source || ''))}${s.model ? ` · ${esc(s.model)}` : ''}${Number.isFinite(s.message_count) ? ` · ${s.message_count} messages` : ''}${s.last_activity_at || s.started_at ? ` · ${ago(secs(s.last_activity_at || s.started_at))}` : ''}</small></span>
      <span class="op-acts">${s.source === 'cron' ? '' : '<button type="button" class="btn small" data-do="chat">💬 Open</button>'}<button type="button" class="btn small danger" data-do="del">Delete</button></span></div>`).join('') || '<p class="hint">No sessions.</p>'}</div>`;
  pickable(el, ctx, 'sessions');
  const row = b => list.find(s => s.id === b.closest('.op-row').dataset.id);
  wire(el, {
    chat: b => ctx.openChat(P.name, row(b).id),
    del: async b => {
      const s = row(b);
      if (!await ctx.confirm({ title: 'Delete a session?', rows: [{ label: s.title || s.id, from: 'kept', to: 'deleted, with its history' }], danger: true })) return;
      if (await act(ctx, b, () => ctx.call('sessions.delete', { profile: P.name, id: s.id }), 'Deleted')) render('sessions', el, ctx);
    },
  });
}

// ------------------------------------------------------------------ Settings (drawn from Hermes' own description)
const at = (o, path) => path.split('.').reduce((v, k) => (v === undefined || v === null ? undefined : v[k]), o);
const SECRET = /(^|[._-])(api[_-]?key|key|token|secret|password|passwd|credential|private[_-]?key|client[_-]?secret|cookie|bearer)s?$/i;
/** The hint this installation suggests for its own chats (Hermes' platform_hints: its sessions here are tagged
 *  'myvirtualworld', a channel Hermes has no built-in hint for). */
export const OWN_HINT = 'You are chatting in My Virtual World, a graphical chat window. Markdown renders (tables, code, lists). Send a file by writing MEDIA:/absolute/path/to/file on its own line: pictures, video and audio show in the chat; other files become a download.';
async function settings(el, ctx) {
  const P = await withProfile(el, ctx);
  const [schema, cfg] = await Promise.all([ctx.call('config.schema', { profile: P.name }), ctx.call('config.get', { profile: P.name })]);
  const fields = schema.fields || {}, order = schema.category_order || [];
  const cats = [...new Set([...order, ...Object.values(fields).map(f => f.category || 'general')])].filter(c => Object.values(fields).some(f => (f.category || 'general') === c));
  const S = { cfg: cfg.config || {}, cat: null, pending: new Map() };
  const hint = at(S.cfg, 'platform_hints.myvirtualworld');
  el.innerHTML = `${P.picker}
    <div class="ap-card${hint ? '' : ' wait'}"><h4>This chat window, for Hermes</h4><p class="hint">Hermes tells an agent how each channel shows its answers. It has no hint of its own for My Virtual World (its chats here are tagged "myvirtualworld"): ${hint ? 'this agent has one.' : 'add one so the agent knows Markdown renders and files can be sent.'}</p>
      ${hint ? '' : '<div class="row"><button type="button" class="btn small primary" data-do="hint">Add the hint</button></div>'}</div>
    <div class="op-set"><nav class="op-secs">${cats.map(c => `<button type="button" class="op-sec" data-do="sec" data-cat="${esc(c)}">${esc(words(c))}</button>`).join('')}</nav>
      <section class="op-pane"><p class="hint">Choose a section. Every change is shown to you before it is saved.</p></section></div>
    <div class="op-savebar hidden"><span class="op-n"></span><button type="button" class="btn" data-do="discard">Discard</button><button type="button" class="btn primary" data-do="review">Review and save</button></div>`;
  pickable(el, ctx, 'settings');
  const paintBar = () => { el.querySelector('.op-savebar').classList.toggle('hidden', !S.pending.size); el.querySelector('.op-n').textContent = `${S.pending.size} change${S.pending.size === 1 ? '' : 's'} not saved`; };
  const open = cat => {
    S.cat = cat;
    for (const b of el.querySelectorAll('.op-sec')) b.classList.toggle('on', b.dataset.cat === cat);
    const rows = Object.entries(fields).filter(([, f]) => (f.category || 'general') === cat);
    el.querySelector('.op-pane').innerHTML = `<div class="op-fields">${rows.map(([path, f]) => fieldHtml(path, f, S)).join('') || '<p class="hint">Nothing to set here.</p>'}</div>`;
  };
  const save = async (b, changes, title, note) => {
    const rows = Object.entries(changes).map(([p, v]) => ({ label: p, from: shown(at(S.cfg, p)), to: SECRET.test(p) ? '•••••• (new)' : shown(v) }));
    if (!await ctx.confirm({ title, rows, note })) return false;
    const base = Object.fromEntries(Object.keys(changes).map(p => [p, at(S.cfg, p) ?? null]));
    const ok = await act(ctx, b, async () => {
      try { await ctx.call('config.patch', { profile: P.name, changes, base }); }
      catch (e) { if (/changed elsewhere/i.test(e.message)) throw new Error('Hermes\' settings were changed elsewhere meanwhile: they are read again — check your changes and save again.'); throw e; }
    }, 'Saved to Hermes');
    S.cfg = (await ctx.call('config.get', { profile: P.name }).catch(() => ({ config: S.cfg }))).config || S.cfg;
    return ok;
  };
  wire(el, {
    sec: b => open(b.dataset.cat),
    discard: () => { S.pending.clear(); paintBar(); if (S.cat) open(S.cat); },
    hint: async b => { if (await save(b, { 'platform_hints.myvirtualworld': { replace: OWN_HINT } }, 'Tell Hermes about this chat window', 'Hermes adds it to what this agent is told in its chats here, from their next session on.')) render('settings', el, ctx); },
    review: async b => {
      const changes = Object.fromEntries([...S.pending].map(([p, x]) => [p, x.value]));
      if (await save(b, changes, 'Save these settings to Hermes', 'Most take effect in new sessions; some need Hermes to restart.')) { S.pending.clear(); paintBar(); if (S.cat) open(S.cat); }
    },
  });
  el.oninput = el.onchange = e => {
    const f = e.target.closest('[data-field]'); if (!f) return;
    const p = f.dataset.field, kind = f.dataset.kind, inp = e.target;
    let v;
    if (kind === 'boolean') v = inp.checked;
    else if (kind === 'number') { if (inp.value === '') { S.pending.delete(p); paintBar(); return; } v = Number(inp.value); if (!Number.isFinite(v)) return; }
    else if (kind === 'list') { try { v = JSON.parse(inp.value || '[]'); if (!Array.isArray(v)) throw new Error('a list'); inp.classList.remove('bad'); } catch { inp.classList.add('bad'); return; } }
    else v = inp.value;
    if (f.dataset.secret && v === '') { S.pending.delete(p); paintBar(); return; }
    S.pending.set(p, { value: v });
    paintBar();
  };
}
function fieldHtml(path, f, S) {
  const cur = S.pending.has(path) ? S.pending.get(path).value : at(S.cfg, path);
  const secret = SECRET.test(path) || (cur && typeof cur === 'object' && cur.secret);
  const label = words(path.split('.').pop()), help = f.description || '';
  const type = secret ? 'secret' : f.type === 'boolean' ? 'boolean' : f.type === 'number' ? 'number' : f.type === 'select' && Array.isArray(f.options) ? 'select' : f.type === 'list' ? 'list' : 'string';
  const head = `<span class="op-fl"><b>${esc(label)}</b> <code>${esc(path)}</code>${help ? `<small>${esc(help)}</small>` : ''}</span>`;
  let input;
  if (type === 'secret') input = `<input class="input" type="password" autocomplete="new-password" placeholder="${cur && cur.set ? 'Set — type a new value to change it' : 'Not set'}">`;
  else if (type === 'boolean') input = `<label class="check"><input type="checkbox"${cur === true ? ' checked' : ''}> ${cur === undefined || cur === null ? '(default)' : ''}</label>`;
  else if (type === 'select') input = `<select class="input">${cur === undefined || cur === null ? '<option value="" selected>(default)</option>' : ''}${f.options.map(o => { const v = typeof o === 'object' ? o.value : o; return `<option value="${esc(String(v))}"${String(cur) === String(v) ? ' selected' : ''}>${esc(String(typeof o === 'object' ? o.label || v : v))}</option>`; }).join('')}</select>`;
  else if (type === 'number') input = `<input class="input" type="number" value="${cur === undefined || cur === null ? '' : esc(String(cur))}" placeholder="(default)">`;
  else if (type === 'list') input = `<textarea class="input op-json" rows="2" spellcheck="false" placeholder="[]">${cur === undefined || cur === null ? '' : esc(JSON.stringify(cur))}</textarea>`;
  else input = `<input class="input" type="text" value="${cur === undefined || cur === null ? '' : esc(typeof cur === 'string' ? cur : JSON.stringify(cur))}" placeholder="(default)">`;
  return `<div class="op-field" data-field="${esc(path)}" data-kind="${type === 'secret' ? 'string' : type}"${secret ? ' data-secret="1"' : ''}>${head}${input}</div>`;
}
