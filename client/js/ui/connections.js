// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Settings → Connections (PLAN WP2.2, CHECKLIST I8.1, I8.7, I8.13; DECISIONS C60, A8, A9).
// The list and the add form are drawn from what the server reports (GET /api/providers: every kind with its fields, whether its
// adapter exists and whether this account may add one; GET
// /api/connections: what this account may see). Nothing about a provider is hard-coded here. Credentials are
// password fields; a saved one is shown only as "set" and a blank keeps it. The server decides what each account may do.
// An agent platform with its own window (a kind marked hub: OpenClaw — Agent Providers, ui/agent-providers.js) is listed
// here too, but added and managed there: its row and the note above the list open it.
import { auth } from '../core/auth.js';
import { getJSON, post } from '../core/net.js';
import { esc } from '../core/util.js';
import { bus } from '../core/state.js';

const SCOPES = { account: 'Personal', installation: 'Shared' };

function fieldHtml(f, value, edit) {
  const id = `cf-${f.key}`, lab = esc(f.label) + (f.required && !edit ? ' *' : '');
  if (f.type === 'secret') return `<label>${lab}<input class="input cf" id="${id}" data-key="${esc(f.key)}" data-secret="1" type="password" autocomplete="new-password" spellcheck="false" maxlength="4000" placeholder="${edit && value ? 'set — leave blank to keep' : ''}"></label>`;
  if (f.type === 'select') return `<label>${lab}<select class="input cf" id="${id}" data-key="${esc(f.key)}">${f.options.map(o => `<option value="${esc(o)}"${(value ?? f.default) === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
  if (f.type === 'boolean') return `<label class="check"><input class="cf" id="${id}" data-key="${esc(f.key)}" data-bool="1" type="checkbox"${(value ?? f.default) ? ' checked' : ''}> ${lab}</label>`;
  return `<label>${lab}<input class="input cf" id="${id}" data-key="${esc(f.key)}" type="${f.type === 'number' ? 'number' : 'text'}" maxlength="500" spellcheck="false" value="${esc(value ?? f.default ?? '')}"></label>`;
}

/** Settings → Connections. */
export async function connectionsTab(d, body) {
  body.innerHTML = '<p class="hint">Loading…</p>';
  const err = m => { const e = d.q('.err'); e.textContent = m || ''; e.classList.toggle('hidden', !m); };
  let kinds = [], conns = [], host = null;
  const load = async () => {
    const [p, c] = await Promise.all([getJSON('/api/providers'), getJSON('/api/connections')]);
    kinds = p.kinds; host = p.host; conns = c.connections;
  };
  try { await load(); } catch (e) { body.innerHTML = `<p class="hint">Could not read the connections: ${esc(e.message)}</p>`; return; }
  err('');
  const manager = auth.can('connections.manage');
  const kindOf = id => kinds.find(k => k.id === id);
  /** Kinds this account may add: the server says (addable); an older server's list falls back to the old rule — members only
   *  the ones that call a remote service, and a server-made kind (connected agents) never by hand. Only working ones are offered. */
  const addable = () => kinds.filter(k => k.implemented && !k.system && !k.hub && ('addable' in k ? k.addable
    : (manager || !k.modes ? (manager || k.connectionKind === 'remote') : k.modes.some(m => m.connectionKind === 'remote'))));

  const statusText = c => {
    if (!c.implemented) return { cls: 'later', text: 'Not available on this server' };
    if (!c.status) return { cls: 'idle', text: 'Not tested yet' };
    if (c.status.state === 'pairing') return { cls: 'idle', text: 'Waiting for approval' };
    return c.status.ok ? { cls: 'ok', text: 'Connected' } : { cls: 'bad', text: c.status.error || 'Not connected' };
  };
  const row = c => {
    const st = statusText(c), m = kindOf(c.kind), mgr = c.level === 'manage';
    if (m && m.hub) return `<div class="conn" data-id="${c.id}">
      <div class="conn-head"><span class="dot ${st.cls}" aria-hidden="true"></span><b>${esc(c.label)}</b><span class="tag">${esc(m.label)}</span><span class="tag">${esc(SCOPES[c.scope] || c.scope)}</span></div>
      <div class="conn-state ${st.cls}">${esc(st.text)}</div>
      <div class="row wrap"><button type="button" class="btn small c-hub">Open in Agent Providers</button></div></div>`;
    return `<div class="conn" data-id="${c.id}">
      <div class="conn-head"><span class="dot ${st.cls}" aria-hidden="true"></span><b>${esc(c.label)}</b>
        <span class="tag">${esc(m ? m.label : c.kind)}</span><span class="tag">${esc(SCOPES[c.scope] || c.scope)}</span>${c.connectionKind === 'host-process' ? '<span class="tag" title="Runs a program on the server">Server program</span>' : ''}
        ${c.enabled ? '' : '<span class="tag">Off</span>'}</div>
      <div class="conn-state ${st.cls}">${esc(st.text)}</div>
      ${c.status && c.status.fix && !c.status.ok ? `<div class="hint">${esc(c.status.fix)}</div>` : ''}
      ${c.status && c.status.detail && c.status.ok ? `<div class="hint">${esc(c.status.detail)}</div>` : ''}
      ${mgr && c.secrets ? `<div class="hint">${Object.entries(c.secrets).map(([k, v]) => `${esc(k)}: <span class="tag ${v ? 'set' : ''}">${v ? 'set' : 'not set'}</span>`).join(' ')}</div>` : ''}
      ${mgr && c.shares ? `<div class="hint">Shared with: ${c.shares.length ? c.shares.map(s => esc(s.kind === 'role' ? `everyone ${s.who} and above` : `account ${s.who}`)).join(', ') : 'nobody yet'}</div>` : ''}
      ${mgr ? `<div class="row wrap"><button type="button" class="btn small c-test">Test</button><button type="button" class="btn small c-disc">Find agents</button>
        <button type="button" class="btn small c-edit">Edit</button>${c.scope === 'installation' ? '<button type="button" class="btn small c-share">Share…</button>' : ''}
        <button type="button" class="btn small danger c-del">Remove</button></div>` : '<div class="hint">Shared with you to use.</div>'}
      <div class="c-out hint hidden" aria-live="polite"></div></div>`;
  };
  const render = () => {
    const list = conns.length ? conns.map(row).join('') : '<p class="hint">No connections yet.</p>';
    const can = addable();
    body.innerHTML = `<h4>🔌 Connections</h4>
      <p class="hint">${manager ? 'A connection links this city to an agent platform or a model provider.' : 'The services your agents use: the ones this city shares with you, and any you add with your own key.'} Credentials are stored sealed and are never shown again.
        ${manager && host ? (host.running ? '' : '<b>The provider helper is not running.</b>') : ''}</p>
      ${kinds.some(k => k.hub && k.implemented) ? `<div class="hint c-hubnote">Agent platforms (${esc(kinds.filter(k => k.hub && k.implemented).map(k => k.label).join(', '))}) are connected in <b>Agent Providers</b>. <button type="button" class="btn small c-hub">Open Agent Providers</button></div>` : ''}
      <div class="conn-list">${list}</div>
      ${can.length ? `<div class="sep"></div><h5>Add a connection</h5>${manager ? '' : `<p class="hint">Your own ${can.map(k => esc(k.label.toLowerCase())).join(' or ')}, with your own key: only you use it.</p>`}` : ''}<div class="c-add"></div>`;
    if (can.length) addForm(body.querySelector('.c-add'));
  };

  function addForm(box, edit = null) {
    const opts = edit ? [kindOf(edit.kind)] : addable();
    if (!opts.length) { box.innerHTML = '<p class="hint">Nothing you can add yet.</p>'; return; }
    box.innerHTML = `<form class="aform c-form">
      ${edit ? '' : `<label>Kind<select class="input c-kind">${opts.map(k => `<option value="${esc(k.id)}">${esc(k.label)}</option>`).join('')}</select></label>`}
      <label>Name<input class="input c-label" maxlength="60" placeholder="What to call it" value="${esc(edit ? edit.label : '')}"></label>
      ${!edit && manager ? `<label>For<select class="input c-scope"><option value="account">Only me</option><option value="installation">Everyone I share it with</option></select></label>` : ''}
      <div class="c-fields"></div>
      <div class="row end">${edit ? '<button type="button" class="btn c-cancel">Cancel</button>' : ''}<button class="btn primary" type="submit">${edit ? 'Save' : 'Add connection'}</button></div>
      <p class="hint c-note"></p></form>`;
    const form = box.querySelector('form'), fields = box.querySelector('.c-fields'), note = box.querySelector('.c-note');
    const kindSel = box.querySelector('.c-kind');
    const drawFields = () => {
      const k = edit ? kindOf(edit.kind) : kindOf(kindSel.value);
      const cfg = edit ? edit.config || {} : {};
      let list = k.fields;
      if (!manager && k.modes) list = list.map(f => f.key === 'mode' ? { ...f, options: f.options.filter(o => (k.modes.find(m => m.id === o) || {}).connectionKind === 'remote') } : f);
      fields.innerHTML = list.map(f => fieldHtml(f, f.type === 'secret' ? (edit && edit.secrets && edit.secrets[f.key]) : cfg[f.key], !!edit)).join('');
      note.textContent = k.implemented ? '' : `${k.label} isn't available on this server.`;
    };
    drawFields();
    if (kindSel) kindSel.onchange = drawFields;
    const cancel = box.querySelector('.c-cancel'); if (cancel) cancel.onclick = render;
    form.onsubmit = async ev => {
      ev.preventDefault(); err('');
      const config = {}, secrets = {};
      for (const el of fields.querySelectorAll('.cf')) {
        const key = el.dataset.key;
        if (el.dataset.secret) { if (el.value) secrets[key] = el.value; }
        else if (el.dataset.bool) config[key] = el.checked;
        else if (el.type === 'number') { if (el.value !== '') config[key] = Number(el.value); }
        else config[key] = el.value.trim();
      }
      const label = box.querySelector('.c-label').value.trim();
      try {
        if (edit) await post('/api/connections/update', { id: edit.id, label, config, secrets });
        else {
          const k = kindOf(kindSel.value), scopeSel = box.querySelector('.c-scope');
          const hostKind = (k.modes ? (k.modes.find(m => m.id === config.mode) || k.modes[0]).connectionKind : k.connectionKind) === 'host-process';
          await post('/api/connections', { kind: k.id, label, scope: hostKind ? 'installation' : (scopeSel ? scopeSel.value : 'account'), config, secrets });
        }
        await load(); render();
      } catch (e) { if (!e.quiet) err(e.message); }
    };
  }

  const act = async (id, action, out) => {
    err(''); out.classList.remove('hidden'); out.textContent = 'Working…';
    try {
      const r = await post(`/api/connections/${action}`, { id });
      if (action === 'discover') out.textContent = r.ok === false ? (r.error || 'Could not look') : (r.agents && r.agents.length ? `Found: ${r.agents.map(a => a.name || a.nativeId).join(', ')}` : 'No agents found');
      else out.textContent = r.ok === false ? `${r.error || 'Not connected'}${r.fix ? ` — ${r.fix}` : ''}` : (r.detail || 'Connected');
      if (action !== 'discover') { await load(); const keep = out.textContent; render(); const o = body.querySelector(`.conn[data-id="${id}"] .c-out`); if (o) { o.textContent = keep; o.classList.remove('hidden'); } }
    } catch (e) { out.textContent = e.message; }
  };
  body.addEventListener('click', async e => {
    if (e.target.closest('.c-hub')) {
      const row = e.target.closest('.conn');
      d.close(false);   // (Settings closes: one window at a time)
      bus.emit('openproviders', row ? Number(row.dataset.id) : null);
      return;
    }
    const el = e.target.closest('.conn'); if (!el) return;
    const id = Number(el.dataset.id), c = conns.find(x => x.id === id), out = el.querySelector('.c-out');
    if (e.target.closest('.c-test')) act(id, 'test', out);
    else if (e.target.closest('.c-disc')) act(id, 'discover', out);
    else if (e.target.closest('.c-edit')) { const box = body.querySelector('.c-add'); addForm(box, c); box.scrollIntoView({ block: 'nearest' }); }
    else if (e.target.closest('.c-del')) { if (confirm(`Remove the connection "${c.label}"? Agents that use it are disconnected; nothing else is deleted.`)) { try { await post('/api/connections/remove', { id }); await load(); render(); } catch (x) { if (!x.quiet) err(x.message); } } }
    else if (e.target.closest('.c-share')) {
      const who = prompt('Share with a role (member, admin) or an account id:', 'member');
      if (!who) return;
      const kind = /^\d+$/.test(who.trim()) ? 'account' : 'role';
      try { await post('/api/connections/share', { id, kind, who: who.trim() }); await load(); render(); } catch (x) { if (!x.quiet) err(x.message); }
    }
  });
  render();
}
