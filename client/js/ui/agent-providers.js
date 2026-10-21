// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agent Providers (docs/features/agent-providers.md): the top bar's button and its window. The left column lists the
// agent platforms this account may see (OpenClaw first), each with its live state; ➕ Add provider connects a new one;
// the right side is the chosen provider's own page: its state, what to do when it waits for approval or something is
// wrong, its agents (Chat opens the chat window with one) - and, for whoever manages it once it is connected, the
// provider's own sub-menu: the module its manifest names (menu: client/js/ui/providers/<menu>.js), drawn in tabs, each of
// its changes shown in a confirmation (what changes, from what to what) before it is sent.
// Everything shown comes from the server: the kinds and their fields, hints and labels (GET /api/agent-providers - no
// provider is described here), each provider's state as it changes (the socket's 'provider' frames), and who may do what.
import { bus } from '../core/state.js';
import { auth } from '../core/auth.js';
import { getJSON, post } from '../core/net.js';
import { h, esc } from '../core/util.js';

let app = null, btn = null, W = null;            // W: the open window's state, or null
const D = { providers: [], kinds: [], at: 0 };    // the last list from the server

const STATE = {
  connected: { cls: 'ok', word: 'Connected' }, connecting: { cls: 'busy', word: 'Connecting…' }, pairing: { cls: 'wait', word: 'Waiting for approval' },
  error: { cls: 'bad', word: 'Needs attention' }, offline: { cls: 'off', word: 'Offline' },
};
const stateOf = p => (p.enabled ? (p.status && STATE[p.status.state] ? p.status.state : 'offline') : 'offline');

export function init(a) {
  app = a;
  app.providers = { open, close, isOpen: () => !!W };
  bus.on('auth', paintButton);
  bus.on('msg:provider', onFrame);
  bus.on('msg:agents', () => { if (W) load().then(paint, () => {}); });
  bus.on('openproviders', id => open(id));
  paintButton();
}

// ------------------------------------------------------------------ the top bar's button
const may = () => !!auth.account && auth.can('connections.use');
function paintButton() {
  const bar = document.getElementById('topbar');
  if (!bar) return;
  if (!btn) {
    btn = h(`<button type="button" class="btn provb" title="Agent Providers: connect OpenClaw, Hermes and your other agent platforms" aria-label="Agent Providers">
      <span class="pv-ic" aria-hidden="true">🧩</span><span class="pv-l">Agent Providers</span><i class="pv-dot" aria-hidden="true"></i></button>`);
    btn.onclick = () => (W ? close() : open());
    bar.insertBefore(btn, bar.querySelector('.helpb'));
  }
  btn.classList.toggle('hidden', !may());
  if (may()) load().then(paintDot, () => {}); else { D.providers = []; paintDot(); }
}
/** The button's dot: the worst state among the providers (red: something to fix; amber: waiting for approval; green: all up). */
function paintDot() {
  if (!btn) return;
  const states = D.providers.filter(p => p.enabled).map(stateOf);
  const cls = !states.length ? '' : states.includes('error') ? 'bad' : states.includes('pairing') ? 'wait' : states.every(s => s === 'connected') ? 'ok' : 'busy';
  const dot = btn.querySelector('.pv-dot');
  dot.className = `pv-dot ${cls}`;
  btn.title = states.length ? `Agent Providers: ${D.providers.map(p => `${p.label} - ${STATE[stateOf(p)].word.toLowerCase()}`).join('; ')}` : 'Agent Providers: connect OpenClaw, Hermes and your other agent platforms';
}

async function load() {
  const r = await getJSON('/api/agent-providers');
  D.providers = r.providers || []; D.kinds = r.kinds || []; D.host = r.host || null; D.at = Date.now();
  return D;
}
function onFrame(m) {
  const p = D.providers.find(x => x.id === m.id);
  if (!p) { if (may()) load().then(() => { paintDot(); paint(); }, () => {}); return; }
  const was = p.status && p.status.state;
  p.status = m.status;
  paintDot();
  if (!W) return;
  // connected now: its agents are listed a moment later (the server lists them as it connects)
  if (m.status.state === 'connected' && was !== 'connected') setTimeout(() => { if (W) load().then(paint, () => {}); }, 900);
  paint();
}

// ------------------------------------------------------------------ the window
export async function open(selectId = null) {
  if (!may()) { app.toast?.('Sign in to connect agent providers', 'bad'); return; }
  if (!W) {
    const el = (document.getElementById('ui') || document.body).appendChild(h(`<div class="modal-back ap-back"><div class="ap panel" role="dialog" aria-modal="true" aria-label="Agent Providers">
      <div class="ap-head"><span class="ap-mark" aria-hidden="true">🧩</span><div class="ap-id"><span class="ap-kicker">Agent Providers</span><h2>Your agent platforms</h2>
        <div class="ap-sub">Connect OpenClaw, Hermes and your other agent platforms; their agents join the chat window.</div></div>
        <span class="spacer"></span><button type="button" class="btn icon ap-x" title="Close (Esc)" aria-label="Close">✕</button></div>
      <div class="ap-main"><nav class="ap-side" aria-label="Providers"></nav><section class="ap-pane" aria-live="polite"></section></div></div></div>`));
    W = { el, sel: null, view: 'provider', busy: false, tab: 'connection', menus: new Map() };
    el.querySelector('.ap-x').onclick = close;
    el.addEventListener('pointerdown', e => { if (e.target === el) close(); });
    el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } });
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('submit', onSubmit);
    W.el.querySelector('.ap-pane').innerHTML = '<p class="hint">Loading…</p>';
  }
  try { await load(); } catch (e) { W.el.querySelector('.ap-pane').innerHTML = `<p class="hint bad">Could not read the providers: ${esc(e.message)}</p>`; return; }
  W.sel = selectId !== null && D.providers.some(p => p.id === Number(selectId)) ? Number(selectId) : (W.sel && D.providers.some(p => p.id === W.sel) ? W.sel : (D.providers[0] ? D.providers[0].id : null));
  W.view = W.sel === null ? 'add' : 'provider';
  paint();
  paintDot();
}
export function close() { if (!W) return; W.el.remove(); W = null; }

function paint() {
  if (!W) return;
  paintSide();
  const pane = W.el.querySelector('.ap-pane');
  // (a form being filled in is never redrawn by a state change under it)
  if (W.view === 'add' || W.view === 'edit') { if (!pane.querySelector('form.ap-form')) paintForm(pane); return; }
  const p = D.providers.find(x => x.id === W.sel);
  if (!p) { W.view = 'add'; paintForm(pane); return; }
  const k = D.kinds.find(x => x.id === p.kind);
  const menu = k && k.menu && p.level === 'manage' && stateOf(p) === 'connected' ? k.menu : null;
  if (!menu && W.tab !== 'connection') W.tab = 'connection';
  // (the sub-menu's own page is drawn by its module, and kept while the provider's state changes under it)
  if (menu && W.tab !== 'connection' && pane.querySelector(`.ap-tabbody[data-for="${p.id}:${W.tab}"]`)) { paintTabs(pane, p, menu); return; }
  pane.innerHTML = `${menu ? '<div class="ap-tabs" role="tablist"></div>' : ''}<div class="ap-tabbody" data-for="${p.id}:${W.tab}"></div>`;
  if (menu) paintTabs(pane, p, menu);
  const body = pane.querySelector('.ap-tabbody');
  if (W.tab === 'connection') body.innerHTML = providerHtml(p);
  else loadMenu(menu).then(mod => mod.render(W.tab, body, ctxFor(p)), e => { body.innerHTML = `<p class="hint bad">${esc(e.message)}</p>`; });
}
/** The provider's tabs: its connection, then its sub-menu's pages. */
function paintTabs(pane, p, menu) {
  const bar = pane.querySelector('.ap-tabs');
  if (!bar) return;
  const mod = W.menus.get(menu);
  const tabs = [{ id: 'connection', label: 'Connection', icon: '🔌' }, ...(mod ? mod.TABS : [])];
  bar.innerHTML = tabs.map(t => `<button type="button" class="btn tab${W.tab === t.id ? ' on' : ''}" role="tab" data-tab="${esc(t.id)}"><span aria-hidden="true">${esc(t.icon)}</span> ${esc(t.label)}</button>`).join('');
  if (!mod) loadMenu(menu).then(() => paintTabs(pane, p, menu), () => {});
}
async function loadMenu(name) {
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(name)) throw new Error('No such sub-menu');
  if (!W.menus.has(name)) W.menus.set(name, await import(`./providers/${name}.js`));
  return W.menus.get(name);
}
/** What a sub-menu's page may do: call its provider (through the server), ask the person's OK for a change, tell them
 *  how it went, open the chat with one of the provider's agents. */
/** What a provider's sub-menu reaches it with. A read the provider answers "busy" (503: OpenClaw while it applies a plugin
 *  or settings change; its documented answer is to retry shortly) is asked again a few times; a change never is - it is
 *  the person's to send again (it may have been applied: the provider's base-hash guard and its reply say so). */
const BUSY_RETRY_MS = [500, 1000, 2000, 4000];
function ctxFor(p) {
  const kind = D.kinds.find(k => k.id === p.kind), writes = new Set((kind && kind.menuWrite) || []);
  const call = async (method, params = {}) => {
    for (let i = 0; ; i++) {
      try { return await post('/api/agent-providers/call', { id: p.id, method, params }); }
      catch (e) { if (e.status !== 503 || writes.has(method) || i >= BUSY_RETRY_MS.length) throw e; await new Promise(r => setTimeout(r, BUSY_RETRY_MS[i])); }
    }
  };
  return {
    call,
    confirm: confirmChange,
    toast: (m, kind = '') => app.toast?.(m, kind, kind === 'bad' ? 6000 : 3000),
    openChat: async (nativeId, sessionKey = null) => {
      const a = (p.agents || []).find(x => x.nativeId === nativeId);
      if (!a) return app.toast?.('That agent is not in the chat yet: List its agents again on the Connection tab', 'bad');
      let session = null;
      if (sessionKey) { try { session = ((await getJSON(`/api/chat/recent?agent=${a.id}`)).sessions || []).find(x => x.key === sessionKey)?.id || null; } catch { /* its latest */ } }
      close();
      if (app.chat) app.chat.open(a.id, session ? { session } : {}); else bus.emit('openagent', a.id);
    },
  };
}
/** The confirmation of a change: what changes, from what to what (and which need a restart); resolves true on OK. */
/** Shows a change and waits for the person's OK. details: lists to read before agreeing ({ label, items }: what a plugin
 *  declares, say), the first dozen of each shown. */
function confirmChange({ title, rows = [], details = [], note = '', danger = false, yes = '' }) {
  return new Promise(resolve => {
    const box = W.el.querySelector('.ap').appendChild(h(`<div class="ap-confirm" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="ap-confirm-card panel">
      <h3>${esc(title)}</h3>
      <table class="ap-diff"><thead><tr><th>Setting</th><th>Now</th><th>After</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.label)}${r.restart ? ' <span class="tag">restart</span>' : ''}</td>
        <td class="was">${esc(String(r.from ?? ''))}</td><td class="now">${esc(String(r.to ?? ''))}</td></tr>`).join('')}</tbody></table>
      ${details.length ? `<div class="ap-decl">${details.map(d => `<p><b>${esc(d.label)} · ${d.items.length}</b>${esc(d.items.slice(0, 12).join(', '))}${d.items.length > 12 ? ` and ${d.items.length - 12} more` : ''}</p>`).join('')}</div>` : ''}
      ${note ? `<p class="hint">${esc(note)}</p>` : ''}
      <div class="row end"><button type="button" class="btn ap-no">Cancel</button><button type="button" class="btn ${danger ? 'danger' : 'primary'} ap-yes">${esc(yes || (danger ? 'Yes, do it' : 'Save'))}</button></div></div></div>`));
    const done = v => { box.remove(); resolve(v); };
    box.querySelector('.ap-no').onclick = () => done(false);
    box.querySelector('.ap-yes').onclick = () => done(true);
    box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } });
    box.querySelector('.ap-yes').focus();
  });
}
function paintSide() {
  const side = W.el.querySelector('.ap-side');
  const addable = D.kinds.filter(k => k.addable);
  side.innerHTML = `${D.providers.map(p => {
    const s = stateOf(p), k = D.kinds.find(x => x.id === p.kind);
    return `<button type="button" class="ap-prov${W.view === 'provider' && W.sel === p.id ? ' on' : ''}" data-id="${p.id}">
      <i class="ap-dot ${STATE[s].cls}" aria-hidden="true"></i><span class="ap-pl"><b>${esc(p.label)}</b>
      <small>${esc(k ? k.label : p.kind)} · ${esc(p.enabled ? STATE[s].word : 'Switched off')}${p.agents && p.agents.length ? ` · ${p.agents.length} agent${p.agents.length === 1 ? '' : 's'}` : ''}</small></span></button>`;
  }).join('')}
    ${addable.length ? `<button type="button" class="btn ap-add${W.view === 'add' ? ' on' : ''}">➕ Add provider</button>` : ''}
    ${!D.providers.length && !addable.length ? '<p class="hint">No agent providers are shared with you yet.</p>' : ''}`;
}

// ------------------------------------------------------------------ one provider's page
function providerHtml(p) {
  const k = D.kinds.find(x => x.id === p.kind) || { label: p.kind };
  const s = stateOf(p), st = p.status || {}, mgr = p.level === 'manage';
  const card = !p.enabled ? `<div class="ap-card"><b>Switched off.</b> Its agents can't chat until it is switched on again.</div>`
    : s === 'pairing' ? `<div class="ap-card wait"><h4>⏳ Waiting for approval</h4><p>${esc(st.detail || '')}</p>
        ${st.requestId ? `<p class="hint">Approve it in OpenClaw's Control UI → Devices, or on the gateway's machine run:</p>
          <div class="ap-cmd"><code>openclaw devices approve ${esc(st.requestId)}</code><button type="button" class="btn small ap-copy" data-copy="openclaw devices approve ${esc(st.requestId)}">Copy</button></div>` : `<p class="hint">${esc(st.fix || '')}</p>`}
        <p class="hint">It connects by itself as soon as it is approved.</p></div>`
    : s === 'error' ? `<div class="ap-card bad"><h4>⚠️ ${esc(st.detail || 'Something is wrong')}</h4>${st.fix ? `<p>${esc(st.fix)}</p>` : ''}
        ${mgr && /^(repair_needed|not_configured|AUTH_|auth_rejected|signin_needed|bad_credentials|signin_engaged)/.test(st.code || '') ? '<div class="row"><button type="button" class="btn small primary ap-edit">Enter the credentials</button></div>' : ''}</div>`
    : s === 'offline' ? `<div class="ap-card"><h4>Offline</h4><p>${esc(st.detail || 'Not connected.')}</p>${st.fix ? `<p class="hint">${esc(st.fix)}</p>` : ''}</div>`
    : s === 'connecting' ? '<div class="ap-card"><h4>Connecting…</h4></div>' : '';
  const agents = (p.agents || []).length
    ? `<div class="ap-agents">${p.agents.map(a => `<div class="ap-agent"><span class="ap-av" aria-hidden="true">${esc(a.emoji || '🤖')}</span><span class="ap-an"><b>${esc(a.name)}</b><small>${esc(a.nativeId || '')}</small></span>
        <button type="button" class="btn small primary ap-chat" data-agent="${a.id}"${s === 'connected' ? '' : ' disabled title="Not connected"'}>💬 Chat</button></div>`).join('')}</div>`
    : `<p class="hint">${s === 'connected' ? 'Its agents are being listed…' : 'Its agents appear here once it is connected.'}</p>`;
  const cfg = mgr && p.config ? p.config : null;
  return `<div class="ap-ph"><div><span class="ap-kicker">${esc(k.label)}</span><h3>${esc(p.label)}</h3>
      <span class="ap-pill ${STATE[s].cls}"><i></i>${esc(p.enabled ? (s === 'connected' && st.version ? `Connected · ${k.label} ${st.version}` : STATE[s].word) : 'Switched off')}</span>
      ${p.scope === 'installation' ? '<span class="tag">Shared</span>' : '<span class="tag">Only you</span>'}</div>
    ${mgr ? `<div class="ap-acts"><button type="button" class="btn small ap-reconnect"${p.enabled ? '' : ' disabled'}>↻ Reconnect</button><button type="button" class="btn small ap-edit">Edit</button>
      <button type="button" class="btn small ap-toggle">${p.enabled ? 'Switch off' : 'Switch on'}</button><button type="button" class="btn small danger ap-remove">Remove</button></div>` : ''}</div>
    ${card}
    <h4 class="ap-h">Agents</h4>${agents}
    ${mgr && s === 'connected' && p.capabilities?.agents ? '<div class="row"><button type="button" class="btn small ap-sync">List its agents again</button></div>' : ''}
    ${cfg ? `<h4 class="ap-h">Connection</h4><div class="kv2"><span>Address</span><b class="mono">${esc(cfg.url || '')}</b></div>
      <div class="kv2"><span>Access</span><b>${esc(labelOf(k, 'access', cfg.access) || '')}</b></div>
      <div class="kv2"><span>Signs in</span><b>${esc(signsIn(k, p, cfg))}</b></div>` : ''}
    ${mgr ? '' : '<p class="hint">Shared with you to chat with its agents. Its owner manages the connection.</p>'}
    <div class="err hidden" role="alert"></div>`;
}
/** How a connection signs in, in words: a provider that pairs devices (k.pairs: OpenClaw) as a paired device or still to
 *  pair; otherwise how its form says it signs in (a token, a username…). */
function signsIn(k, p, cfg) {
  if (k.pairs) return p.paired ? 'As a paired device, with its own key' : 'With the gateway\'s token, to pair';
  const how = labelOf(k, 'auth', cfg.auth) || '';
  return cfg.username && cfg.auth === 'password' ? `${how}: ${cfg.username}` : how;
}
const labelOf = (k, key, v) => { const f = (k.fields || []).find(x => x.key === key); return f ? ((f.labels && f.labels[v ?? f.default]) || (v ?? f.default)) : v; };

// ------------------------------------------------------------------ adding and editing
function paintForm(pane) {
  const edit = W.view === 'edit' ? D.providers.find(x => x.id === W.sel) : null;
  const kinds = edit ? [D.kinds.find(k => k.id === edit.kind)].filter(Boolean) : D.kinds.filter(k => k.addable);
  if (!kinds.length) { pane.innerHTML = '<p class="hint">There is nothing you can add.</p>'; return; }
  const k = kinds.find(x => x.id === W.kind) || kinds[0];
  W.kind = k.id;
  const admin = auth.can('connections.manage');
  pane.innerHTML = `<form class="ap-form aform" autocomplete="off">
    <div class="ap-ph"><div><span class="ap-kicker">${edit ? 'Edit' : 'Add provider'}</span><h3>${edit ? esc(edit.label) : 'Connect an agent platform'}</h3></div></div>
    ${edit ? '' : `<div class="ap-kinds" role="radiogroup" aria-label="Provider">${kinds.map(x => `<button type="button" class="ap-kind${x.id === k.id ? ' on' : ''}" role="radio" aria-checked="${x.id === k.id}" data-kind="${esc(x.id)}">
      <b>${esc(x.label)}</b></button>`).join('')}</div>`}
    <label>Name<input class="input ap-label" maxlength="60" placeholder="${esc(k.label)}" value="${esc(edit ? edit.label : '')}"></label>
    ${!edit && admin ? `<label>For<select class="input ap-scope"><option value="installation">This installation (shared with whom you choose)</option><option value="account">Only me</option></select>
      <small class="hint">A provider on this machine or your local network must be the installation's.</small></label>` : ''}
    <div class="ap-fields">${k.fields.map(f => fieldHtml(f, edit)).join('')}</div>
    <div class="err hidden" role="alert"></div>
    <div class="row end">${edit || D.providers.length ? '<button type="button" class="btn ap-cancel">Cancel</button>' : ''}<button class="btn primary" type="submit">${edit ? 'Save' : `Connect ${esc(k.label)}`}</button></div>
  </form>`;
  showFields(pane);
}
function fieldHtml(f, edit) {
  const v = edit && edit.config ? edit.config[f.key] : undefined, id = `apf-${f.key}`;
  const hint = f.hint ? `<small class="hint">${esc(f.hint)}</small>` : '';
  const show = f.showIf ? ` data-show-if='${esc(JSON.stringify(f.showIf))}'` : '';
  if (f.type === 'secret') {
    const set = edit && edit.secrets && edit.secrets[f.key];
    // (a credential handed off once paired: not needed while the device is paired; typed again, it pairs again)
    const ph = set ? 'Set - leave blank to keep it' : f.handoff && edit && edit.paired ? 'Not needed: it is paired. Type it only to pair again.' : '';
    return `<label class="ap-f"${show}>${esc(f.label)}<input class="input apf" id="${id}" data-key="${esc(f.key)}" data-secret="1" type="password" autocomplete="new-password" spellcheck="false" maxlength="4000" placeholder="${esc(ph)}">${hint}</label>`;
  }
  if (f.type === 'select') {
    return `<label class="ap-f"${show}>${esc(f.label)}<select class="input apf" id="${id}" data-key="${esc(f.key)}">${f.options.map(o => `<option value="${esc(o)}"${(v ?? f.default) === o ? ' selected' : ''}>${esc((f.labels && f.labels[o]) || o)}</option>`).join('')}</select>${hint}</label>`;
  }
  if (f.type === 'boolean') return `<label class="check ap-f"${show}><input class="apf" id="${id}" data-key="${esc(f.key)}" data-bool="1" type="checkbox"${(v ?? f.default) ? ' checked' : ''}> ${esc(f.label)}${hint}</label>`;
  const find = f.type === 'url' && f.key === 'url' && auth.can('connections.manage') ? '<button type="button" class="btn small ap-find" title="Look for one on this machine">🔎 Find</button>' : '';
  return `<label class="ap-f"${show}>${esc(f.label)}<span class="ap-inrow"><input class="input apf" id="${id}" data-key="${esc(f.key)}" type="${f.type === 'number' ? 'number' : 'text'}" maxlength="500" spellcheck="false" value="${esc(v ?? f.default ?? '')}">${find}</span><span class="ap-found"></span>${hint}</label>`;
}
/** A field shown only with another field's value (showIf: { auth: 'token' }). */
function showFields(root) {
  const val = key => { const el = root.querySelector(`.apf[data-key="${key}"]`); return el ? (el.dataset.bool ? el.checked : el.value) : undefined; };
  for (const el of root.querySelectorAll('[data-show-if]')) {
    let cond = {}; try { cond = JSON.parse(el.dataset.showIf); } catch { /* shown */ }
    el.classList.toggle('hidden', !Object.entries(cond).every(([k, v]) => val(k) === v));
  }
}
function formValues(form) {
  const config = {}, secrets = {};
  for (const el of form.querySelectorAll('.apf')) {
    if (el.closest('.hidden')) continue;
    const key = el.dataset.key;
    if (el.dataset.secret) { if (el.value) secrets[key] = el.value; }
    else if (el.dataset.bool) config[key] = el.checked;
    else if (el.type === 'number') { if (el.value !== '') config[key] = Number(el.value); }
    else config[key] = el.value.trim();
  }
  return { config, secrets };
}

// ------------------------------------------------------------------ what a click does
const err = m => { const e = W && W.el.querySelector('.ap-pane .err'); if (e) { e.textContent = m || ''; e.classList.toggle('hidden', !m); } };
async function onClick(e) {
  const t = e.target;
  const prov = t.closest('.ap-prov');
  if (prov) { const id = Number(prov.dataset.id); if (id !== W.sel) W.tab = 'connection'; W.sel = id; W.view = 'provider'; W.el.querySelector('.ap-pane').innerHTML = ''; paint(); return; }
  const tab = t.closest('.ap-tabs [data-tab]');
  if (tab) { W.tab = tab.dataset.tab; W.el.querySelector('.ap-pane').innerHTML = ''; paint(); return; }
  if (t.closest('.ap-tabbody') && W.tab !== 'connection') return;   // (the sub-menu's page handles its own clicks)
  if (t.closest('.ap-add')) { W.view = 'add'; W.kind = null; W.el.querySelector('.ap-pane').innerHTML = ''; paint(); return; }
  const kind = t.closest('.ap-kind');
  if (kind) { W.kind = kind.dataset.kind; paintForm(W.el.querySelector('.ap-pane')); return; }
  if (t.closest('.ap-cancel')) { W.view = W.sel !== null ? 'provider' : 'add'; W.el.querySelector('.ap-pane').innerHTML = ''; paint(); return; }
  const copy = t.closest('.ap-copy');
  if (copy) { copyText(copy.dataset.copy, copy); return; }
  const chat = t.closest('.ap-chat');
  if (chat) { const id = Number(chat.dataset.agent); close(); bus.emit('openagent', id); return; }
  if (t.closest('.ap-find')) { find(t.closest('.ap-f')); return; }
  const use = t.closest('.ap-use');
  if (use) { const input = use.closest('.ap-f').querySelector('.apf'); input.value = use.dataset.url; use.closest('.ap-found').innerHTML = ''; return; }
  const p = D.providers.find(x => x.id === W.sel);
  if (!p) return;
  if (t.closest('.ap-edit')) { W.view = 'edit'; W.el.querySelector('.ap-pane').innerHTML = ''; paint(); return; }
  if (t.closest('.ap-reconnect')) return act(t, () => post('/api/agent-providers/reconnect', { id: p.id }));
  if (t.closest('.ap-sync')) return act(t, async () => { const v = await post('/api/agent-providers/sync', { id: p.id }); Object.assign(p, v); });
  if (t.closest('.ap-toggle')) return act(t, () => post('/api/connections/update', { id: p.id, enabled: !p.enabled }));
  if (t.closest('.ap-remove')) {
    const k = D.kinds.find(x => x.id === p.kind) || {}, full = p.config && p.config.access !== 'chat';
    return confirmChange({ title: `Remove "${p.label}"?`, rows: [{ label: 'Provider', from: p.label, to: 'removed' }], danger: true,
      note: `Its agents leave the chat window; their chats here are kept.${!k.pairs || full ? '' : ' Its device stays listed in the provider until you revoke it there.'}` }).then(ok => ok && act(t, async () => {
      const r = await post('/api/agent-providers/remove', { id: p.id });
      app.toast?.(!k.pairs ? `Removed "${p.label}"` : r && r.unpaired ? `Removed "${p.label}" and took it off the provider's devices` : `Removed "${p.label}". Its device is still listed in the provider: revoke it there (${k.label}: its list of devices) if you won't use it again.`, 'good', 6000);
      W.sel = null;
    }));
  }
}
async function act(button, fn) {
  if (W.busy) return;
  W.busy = true; button.disabled = true; err('');
  try { await fn(); await load(); paint(); paintDot(); }
  catch (x) { if (!x.quiet) err(x.message); button.disabled = false; }
  finally { W.busy = false; }
}
function onChange(e) {
  if (e.target.closest('.ap-form')) showFields(e.target.closest('.ap-form'));
}
async function onSubmit(e) {
  const form = e.target.closest('.ap-form');
  if (!form) return;
  e.preventDefault();
  if (W.busy) return;
  const { config, secrets } = formValues(form);
  const label = form.querySelector('.ap-label').value.trim();
  const submit = form.querySelector('[type=submit]');
  W.busy = true; submit.disabled = true; err('');
  try {
    let id;
    if (W.view === 'edit') { await post('/api/connections/update', { id: W.sel, label, config, secrets }); id = W.sel; }
    else {
      const scope = form.querySelector('.ap-scope') ? form.querySelector('.ap-scope').value : 'account';
      const c = await post('/api/connections', { kind: W.kind, label, scope, config, secrets });
      id = c.id;
    }
    W.sel = id; W.view = 'provider';
    await load(); W.el.querySelector('.ap-pane').innerHTML = ''; paint(); paintDot();
  } catch (x) { if (!x.quiet) err(x.message); submit.disabled = false; }
  finally { W.busy = false; }
}
async function find(field) {
  const out = field.querySelector('.ap-found');
  out.innerHTML = '<small class="hint">Looking…</small>';
  try {
    const r = await post('/api/agent-providers/detect', { kind: W.kind });
    out.innerHTML = r.found.length ? `<small class="hint">Found:</small> ${r.found.map(u => `<button type="button" class="btn small ap-use" data-url="${esc(u)}">${esc(u)}</button>`).join(' ')}`
      : '<small class="hint">None found on this machine. Type its address.</small>';
  } catch (x) { out.innerHTML = `<small class="hint bad">${esc(x.message)}</small>`; }
}
async function copyText(text, b) {
  try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1600); }
  catch { const code = b.parentElement.querySelector('code'); const r = document.createRange(); r.selectNodeContents(code); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
}
