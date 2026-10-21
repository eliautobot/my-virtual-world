// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Third-party agents (PLAN WP2.14, CHECKLIST I8.14, I8.15; DECISIONS E22, E23, C122 to C130; 2026-10-12 the product owner:
// make it simple, start it from ➕ New agent, everything about one agent in its Studio).
// · mountSlotControls: one third-party agent's own settings, shown in its Studio (Brain → Its connection): who sees it,
//   who may chat with it, pausing chat, appearing in the world, its wake-up link, reports and blocks, a new kit code.
// · agentSlotsTab: Settings → Third-party agents, the overview: every third-party agent with its state (and the step that
//   is missing: finish connecting, approve, open its Studio), the AI apps that act for this account with Disconnect, and
//   the advanced connection (the command-line kit with a one-time code) for programs and AIs without MCP.
// The server decides everything; this only asks. A one-time code lives on the screen only until it is closed.
import { getJSON, post } from '../core/net.js';
import { esc } from '../core/util.js';
import { bus } from '../core/state.js';
import { buildAgentPrompt } from '../core/agent-prompt.js';
import { agentApp } from '/shared/agent-apps.js';
import { AGENT_APP_STEPS, readWakePaste, fillAgentApp } from '../core/agent-app-steps.js';

const VIS = [['hidden', 'Hidden: only me'], ['friends', 'Friends only'], ['public', 'Public: everyone can see it']];
const AUD = [['owner', 'Only me'], ['friends', 'My friends'], ['everyone', 'Everyone who can see it']];
const fmt = ms => new Date(ms).toLocaleString();
const opts = (list, cur) => list.map(([v, t]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`).join('');
const logo = a => { const p = agentApp(a.app); return p ? `<span class="na-logo na-sm" style="background:${esc(p.tile)}"><img src="${esc(p.logo)}" alt="" draggable="false"></span>` : '<span class="na-logo na-sm na-plug" aria-hidden="true">🔌</span>'; };

/** Where a third-party agent is: [dot class, words, what is missing]. */
export function slotState(a) {
  if (a.status === 'active' && a.approval === 'waiting') return ['later', 'Waiting for your OK', 'approve'];
  if (a.status === 'active') return ['ok', a.online ? 'Connected · online' : 'Connected', 'studio'];
  if (a.status === 'revoked') return ['bad', 'Disconnected', 'reconnect'];
  return ['later', 'Not connected yet', 'finish'];
}

// The instructions for an agent that connects with the kit: this world's address, the contract (/skill.md, from this same
// server) and, when given, the code that is on the screen. If the browser refuses the clipboard (plain http, no permission)
// the text is shown selected to copy by hand.
async function copyPrompt(host, code) {
  const say = host.querySelector('.a-prompt-out') || host.appendChild(Object.assign(document.createElement('div'), { className: 'a-prompt-out hint' }));
  say.setAttribute('aria-live', 'polite'); say.classList.remove('hidden'); say.textContent = 'Preparing…';
  try {
    const r = await fetch('/skill.md', { cache: 'no-store' });
    if (!r.ok) throw new Error(`the instructions answered ${r.status}`);
    const text = buildAgentPrompt({ origin: location.origin, skill: await r.text(), ...(code ? code : {}) });
    try { await navigator.clipboard.writeText(text); say.textContent = code ? 'Copied, with the one-time code. Paste it into your agent now.' : 'Copied. Paste it into your agent.'; }
    catch {
      say.innerHTML = 'Your browser did not allow copying. Select the text below and copy it by hand:<textarea class="input a-prompt-text" readonly rows="8" data-testid="agent-prompt-text"></textarea>';
      const t = say.querySelector('textarea'); t.value = text; t.focus(); t.select();
    }
  } catch (x) { say.textContent = `Could not prepare the instructions: ${x.message}`; }
}

const codeBox = (shown, name) => `<div class="code-box"><b>One-time code</b> (shown once, valid until ${esc(fmt(shown.expires))}):<br>
    <code class="a-code" data-testid="agent-code">${esc(shown.code)}</code>
    <div class="row wrap"><button type="button" class="btn small a-copy">Copy code only</button>
      <button type="button" class="btn small primary a-copy-prompt" data-with-code="1">Copy instructions with this code</button></div>
    <div class="hint">Paste the instructions into ${esc(name)}'s program: they hold this code, this world's address and everything it needs to connect. It signs the code with its own key, so the key never leaves its computer.</div></div>`;

// ------------------------------------------------------------------------------------------------ one agent (its Studio)
const WAKE_EVENTS = [['owner', 'Your messages'], ['others', 'Messages from others: friends, visitors, other agents'], ['problems', 'Its problems: rent, money, a home, a job']];

/**
 * A third-party agent's own settings, rendered into host and kept up to date (its Studio: Brain → Its connection).
 * slot: its entry of GET /api/agent-slots; onChange(slot, { replaced }): called with the fresh slot after every change
 * (replaced: the host was painted over meanwhile, so it should paint again from this slot).
 */
export function mountSlotControls(host, slot, { onChange = null } = {}) {
  let a = slot, shown = null, wakeOpen = false;
  const err = m => { const e = host.querySelector('.a-err'); e.textContent = m || ''; e.classList.toggle('hidden', !m); };
  // (after any change its host is told, so a repaint of the Studio reads the slot again instead of a copy from before)
  const reload = async () => { const s = (await getJSON('/api/agent-slots')).agents.find(x => x.id === a.id); if (s) a = s; onChange?.(a, { replaced: !host.isConnected }); if (host.isConnected) render(); };
  const wakeUp = () => {
    const w = a.wakeUp; if (!w || a.status !== 'active') return '';
    const tag = !w.set ? 'Off' : w.paused ? 'Paused' : !w.enabled ? 'Turned off by the admin' : `On · ${w.host}`;
    const last = w.set && w.last ? `Last call ${esc(fmt(w.last.at))}: ${w.last.ok ? 'it answered' : w.last.status === 'limit' ? 'skipped, the hour\'s calls were used' : `failed (${esc(w.last.status || 'no answer')})`} · ${w.sentLastHour} in the last hour` : w.set ? 'Not called yet' : '';
    const per = [1, 2, 4, 6, 12, 30, 60].filter(n => n <= w.cap);
    const cur = w.set ? w.perHour : Math.min(6, w.cap);
    const saved = w.set ? 'Saved: paste a new one to replace it' : '';
    const app = agentApp(a.app), guided = app && AGENT_APP_STEPS[app.id]?.wakeup;
    return `<details class="a-wake"${wakeOpen ? ' open' : ''} data-testid="agent-wakeup"><summary><b>🔔 Wake-up link</b> <span class="tag${w.set && !w.paused ? ' set' : ''}">${esc(tag)}</span></summary>
      <p class="hint">An outside AI thinks only while its own app runs it. If that app can start it from a web address (a routine or automation with a webhook), the world calls it when something is waiting for ${esc(a.name)} and it isn't already at work, so it answers while you're away. The call carries no words or names, only that something is waiting; each call uses your plan there.${guided ? '' : ' An AI that can see that address itself can also set it on its own (the world tries it first, and you are told).'}</p>
      ${guided ? `<div class="row wrap"><button type="button" class="btn small primary a-wk-guide">${w.set ? 'Set it up again' : 'Set it up'} step by step</button><span class="hint">${esc(app.name)} makes its own routine; you paste two things back.</span></div>
      ${guided?.ask ? `<div class="row wrap a-wk-ask"><span class="hint">Can't find them? In the ${esc(app.name)} app on your computer (the phone app can't open the links), send it this, then click the links in its reply:</span><button type="button" class="btn small a-wk-copy-ask">Copy the message</button></div>` : ''}
      <div class="hint">Or paste them yourself:</div>` : ''}
      ${w.paused ? '<p class="hint warn">Paused after failing several times in a row. Check the address and save it again.</p>' : ''}
      <div class="aform">
        <label>Address (POST to)<input class="input mono a-wk-url" type="password" autocomplete="off" spellcheck="false" maxlength="1000" placeholder="${esc(saved || 'https://…')}"></label>
        <label>Key<input class="input mono a-wk-key" type="password" autocomplete="off" spellcheck="false" maxlength="1000" placeholder="${esc(saved || 'the secret it gave you, if any')}"></label>
        <label>Header<input class="input mono a-wk-header" autocomplete="off" spellcheck="false" maxlength="1100" placeholder="${esc(saved ? 'Saved' : 'as it gave you, e.g. Authorization: Bearer … (leave empty if none)')}"></label>
        <div class="hint">Wake it for</div>
        ${WAKE_EVENTS.map(([k, t]) => `<label class="check"><input type="checkbox" class="a-wk-ev" data-ev="${k}"${!w.set || w.events?.[k] !== false ? ' checked' : ''}> ${esc(t)}</label>`).join('')}
        <label>At most<select class="input a-wk-per">${per.map(n => `<option value="${n}"${n === cur ? ' selected' : ''}>${n} call${n === 1 ? '' : 's'} an hour</option>`).join('')}</select></label>
      </div>
      <div class="row wrap"><button type="button" class="btn small primary a-wk-save">Save</button>${w.set ? '<button type="button" class="btn small a-wk-test">Try it now</button><button type="button" class="btn small danger a-wk-remove">Remove</button>' : ''}</div>
      <div class="hint a-wk-out">${last}</div></details>`;
  };
  const render = () => {
    const kit = a.via === 'key' || (!a.app && a.status !== 'active');
    host.innerHTML = `<div class="agent-slot" data-id="${a.id}" data-testid="slot-controls">
      ${shown ? codeBox(shown, a.name) : ''}
      <div class="aform a-set">
        <label>Who can see it<select class="input a-vis">${opts(VIS, a.visibility)}</select></label>
        <label>Who can chat with it<select class="input a-aud">${opts(AUD, a.chatAudience)}</select></label>
        <label class="check"><input type="checkbox" class="a-pause"${a.chatPaused ? ' checked' : ''}> Pause chat for everyone but me</label>
        <label class="check"><input type="checkbox" class="a-appear"${a.appearInWorld ? ' checked' : ''}> Let it appear in the world</label>
      </div>
      ${wakeUp()}
      <div class="row wrap">
        <button type="button" class="btn small a-reports">Reports and blocked people</button>
        ${kit ? `<button type="button" class="btn small a-code-new">${a.status === 'active' ? 'New code (replace its key)' : 'A code for the kit'}</button>` : ''}
      </div>
      <div class="c-out hint hidden" aria-live="polite"></div>
      <p class="err hidden a-err" role="alert"></p></div>`;
  };
  const change = async patch => {
    err('');
    try { await post('/api/agent-slots/update', { id: a.id, ...patch }); await reload(); } catch (e) { if (!e.quiet) err(e.message); await reload(); }
  };
  host.addEventListener('toggle', e => { if (e.target.closest?.('.a-wake')) wakeOpen = e.target.open; }, true);
  // pasting the address and the header (or key) together into any of the three: each goes to its own field
  host.addEventListener('paste', e => {
    if (!e.target.closest?.('.a-wk-url, .a-wk-key, .a-wk-header')) return;
    const r = readWakePaste(e.clipboardData?.getData('text') || ''), parts = [r.url, r.key, r.header].filter(Boolean).length;
    if (parts < 2 && !(r.header && !e.target.classList.contains('a-wk-header'))) return;
    e.preventDefault();
    const el = host.querySelector('.agent-slot');
    if (r.url) el.querySelector('.a-wk-url').value = r.url;
    if (r.header) { el.querySelector('.a-wk-header').value = r.header; el.querySelector('.a-wk-key').value = ''; }
    else if (r.key) el.querySelector('.a-wk-key').value = r.key;
  });
  host.addEventListener('change', e => {
    if (e.target.classList.contains('a-vis')) change({ visibility: e.target.value });
    else if (e.target.classList.contains('a-aud')) change({ chatAudience: e.target.value });
    else if (e.target.classList.contains('a-pause')) change({ chatPaused: e.target.checked });
    else if (e.target.classList.contains('a-appear')) change({ appearInWorld: e.target.checked });
  });
  host.addEventListener('click', async e => {
    const el = host.querySelector('.agent-slot'); if (!el) return;
    const q = s => el.querySelector(s), out = text => { const o = q('.c-out'); o.textContent = text; o.classList.remove('hidden'); };
    err('');
    try {
      if (e.target.closest('.a-copy')) { await navigator.clipboard.writeText(shown.code); out('Copied'); }
      else if (e.target.closest('.a-copy-prompt')) await copyPrompt(el, shown ? { code: shown.code, expires: shown.expires, name: a.name } : null);
      else if (e.target.closest('.a-code-new')) {
        if (a.status !== 'pending' && !confirm(`Make a new code for "${a.name}"? When it connects with it, its old key stops working.`)) return;
        const r = await post('/api/agent-slots/code', { id: a.id });
        shown = { code: r.code, expires: r.codeExpires }; await reload();
      } else if (e.target.closest('.a-wk-save')) {
        const url = q('.a-wk-url').value.trim();
        const body = { id: a.id, events: Object.fromEntries([...el.querySelectorAll('.a-wk-ev')].map(c => [c.dataset.ev, c.checked])), perHour: Number(q('.a-wk-per').value) };
        if (url) Object.assign(body, { url, key: q('.a-wk-key').value.trim(), header: q('.a-wk-header').value.trim() });
        else if (q('.a-wk-key').value.trim() || q('.a-wk-header').value.trim()) throw new Error('Paste the address (POST to) too');
        wakeOpen = true; await post('/api/agent-slots/wakeup', body); await reload();
        host.querySelector('.a-wk-out')?.replaceChildren(document.createTextNode('Saved.'));
      } else if (e.target.closest('.a-wk-copy-ask')) {
        // asks the app for links to its routine's webhook fields (Grok Bot opens the routine's panel from them)
        await navigator.clipboard.writeText(fillAgentApp(AGENT_APP_STEPS[a.app].wakeup.ask, { name: a.name }));
        out('Copied: send it to your Bot, then click the Webhook URL and Authorization header links in its answer');
      } else if (e.target.closest('.a-wk-guide')) {
        // the same step as in ➕ New agent: the app makes its routine, its owner pastes its address and header back
        const { openNewAgent } = await import('./new-agent.js');
        wakeOpen = true; await openNewAgent(null, { slot: a, step: 'wakeup' }); await reload();
      } else if (e.target.closest('.a-wk-test')) {
        q('.a-wk-out').textContent = 'Calling it…';
        const r = await post('/api/agent-slots/wakeup/test', { id: a.id });
        wakeOpen = true; await reload();
        host.querySelector('.a-wk-out')?.replaceChildren(document.createTextNode(r.ok ? `It answered (${r.status}): its app should start it now.` : `It didn't work: ${r.error || r.status}`));
      } else if (e.target.closest('.a-wk-remove')) {
        if (!confirm(`Remove the wake-up link of "${a.name}"? The world stops starting its AI.`)) return;
        wakeOpen = true; await post('/api/agent-slots/wakeup', { id: a.id, url: '' }); await reload();
      } else if (e.target.closest('.a-reports')) {
        const r = await getJSON(`/api/agent-slots/reports?id=${a.id}`);
        const rows = r.reports.length ? r.reports.map(x => `<li>${esc(x.name || `account ${x.account}`)}: ${esc(x.reason)} <span class="dim">(${esc(fmt(x.created))})</span> <button type="button" class="btn small a-block" data-account="${x.account}">Block</button></li>`).join('') : '<li class="dim">No reports.</li>';
        const blocked = r.blocked.length ? r.blocked.map(b => `<li>account ${b} <button type="button" class="btn small a-unblock" data-account="${b}">Unblock</button></li>`).join('') : '<li class="dim">Nobody is blocked.</li>';
        const o = q('.c-out'); o.innerHTML = `<b>Reports</b><ul>${rows}</ul><b>Blocked</b><ul>${blocked}</ul>`; o.classList.remove('hidden');
      } else if (e.target.closest('.a-block, .a-unblock')) {
        const b = e.target.closest('.a-block, .a-unblock');
        await post(`/api/agent-slots/${b.classList.contains('a-block') ? 'block' : 'unblock'}`, { id: a.id, account: Number(b.dataset.account) });
        q('.a-reports').click();
      }
    } catch (x) { if (!x.quiet) err(x.message); }
  });
  render();
}

// ------------------------------------------------------------------------------------------------ Settings → Third-party agents
/** Settings → Third-party agents: the overview of this account's third-party agents and the AI apps acting for it. */
export async function agentSlotsTab(d, body, app = null) {
  body.innerHTML = '<p class="hint">Loading…</p>';
  const err = m => { const e = d.q('.err'); e.textContent = m || ''; e.classList.toggle('hidden', !m); };
  let agents = [], recs = [], grants = null, shown = null;   // shown: { id, code, expires } while a fresh kit code is on screen
  const load = async () => {
    const [r, g, list] = await Promise.all([getJSON('/api/agent-slots'), getJSON('/api/connector/grants').catch(() => null), getJSON('/api/agents').catch(() => ({ agents: [] }))]);
    agents = r.agents; grants = g ? g.grants : null; recs = list.agents || [];
  };
  try { await load(); } catch (e) { body.innerHTML = `<p class="hint">Could not read your agents: ${esc(e.message)}</p>`; return; }
  err('');
  const recOf = a => recs.find(x => x.key === `ext-${a.id}`) || null;
  const row = a => {
    const [cls, text, next] = slotState(a), app = agentApp(a.app), rec = recOf(a);
    const action = next === 'finish' && app ? `<button type="button" class="btn small primary s-finish">Finish connecting</button>`
      : next === 'approve' ? '<button type="button" class="btn small primary s-approve" data-testid="agent-approve">Approve</button><button type="button" class="btn small danger s-decline" data-testid="agent-decline">Decline</button>'
        : next === 'reconnect' && app ? '<button type="button" class="btn small s-finish">Connect again</button>' : '';
    return `<div class="conn agent-slot-row" data-id="${a.id}">
      <div class="conn-head">${logo(a)}<b>${esc(a.name)}</b><span class="dot ${cls}" aria-hidden="true"></span><span class="tag">${esc(text)}</span>
        <span class="dim">${esc(app ? app.name : a.via === 'key' ? 'the kit' : 'any AI app')}</span></div>
      ${next === 'approve' ? `<p class="hint warn a-waiting" data-testid="agent-waiting">An AI joined "${esc(a.name)}" with its code. Its key starts with <code>${esc(String(a.fingerprint || '').slice(0, 16))}</code>: approve it only if your own AI tells you the same key.</p>` : ''}
      ${shown && shown.id === a.id ? codeBox(shown, a.name) : ''}
      <div class="row wrap">${action}${rec && a.status === 'active' ? '<button type="button" class="btn small s-studio">Open its Studio</button>' : ''}
        ${a.status === 'active' && a.approval === 'approved' ? '<button type="button" class="btn small danger s-revoke">Disconnect</button>' : ''}
        ${a.status === 'pending' && !a.enrolledAt ? '<button type="button" class="btn small danger s-remove">Remove</button>' : '<button type="button" class="btn small danger s-delete">Delete</button>'}</div>
      <div class="c-out hint hidden" aria-live="polite"></div></div>`;
  };
  const grantRow = g => `<div class="conn ai-grant" data-grant="${g.id}"><div class="conn-head"><span class="dot ok" aria-hidden="true"></span><b>${esc(g.app)}</b>
      <span class="tag">acts as ${esc(g.agent ? `${g.agent.emoji || ''} ${g.agent.name}`.trim() : 'an agent')}</span></div>
    <div class="hint">Connected ${esc(fmt(g.created))}${g.lastUsed ? ` · last used ${esc(fmt(g.lastUsed))}` : ' · not used yet'}</div>
    <div class="row wrap"><button type="button" class="btn small danger ai-revoke">Disconnect</button></div></div>`;
  const render = () => {
    body.innerHTML = `<h4>🤖 Third-party agents</h4>
      <p class="hint">AI apps you already use, like Grok Bot, OpenAI Dot or Meta Muse, can live here as one of your agents. Make one with
        <b>➕ New agent</b>; everything about one agent (who sees it, who may chat with it, its wake-up link) is in its Studio.</p>
      <div class="row wrap"><button type="button" class="btn primary s-new">➕ New third-party agent</button></div>
      <div class="conn-list">${agents.length ? agents.map(row).join('') : '<p class="hint">No third-party agents yet.</p>'}</div>
      ${grants ? `<div class="sep"></div><h5>AI apps with access</h5>
        <p class="hint">The apps you signed in to this world, and which agent each acts as. Disconnecting one stops it at once.</p>
        <div class="conn-list ai-list">${grants.length ? grants.map(grantRow).join('') : '<p class="hint">No AI app has access.</p>'}</div>` : ''}
      <div class="sep"></div>
      <details class="a-adv"${shown ? ' open' : ''}><summary><b>Advanced: another AI or a program of your own</b></summary>
        <p class="hint">Any AI app with MCP can add this world's address as a custom connector: <code>${esc(`${location.origin}/mcp`)}</code>, then sign in and choose an agent. Programs and AIs without MCP (Claude Code, OpenClaw, a script) use the command-line kit with a one-time code instead.</p>
        <div class="row wrap"><button type="button" class="btn small a-mcp-copy">Copy the address</button><button type="button" class="btn small a-kit-copy" data-testid="copy-instructions">Copy instructions for the kit</button></div>
        <div class="a-prompt-host"></div>
        <form class="aform a-new"><label>New agent for the kit: its name<input class="input a-name" maxlength="40" placeholder="What to call it"></label>
          <div class="row end"><button class="btn small" type="submit">Create and show its code</button></div></form></details>`;
    body.querySelector('.a-new').onsubmit = async ev => {
      ev.preventDefault(); err('');
      try {
        const r = await post('/api/agent-slots', { name: body.querySelector('.a-name').value.trim() });
        shown = { id: r.slot.id, code: r.code, expires: r.codeExpires };
        await load(); render(); bus.emit('agentlist');
      } catch (e) { if (!e.quiet) err(e.message); }
    };
  };
  const openWizard = async slot => { (await import('./new-agent.js')).openNewAgent(app, slot ? { slot } : {}); };
  body.addEventListener('click', async e => {
    if (e.target.closest('.s-new')) return openWizard(null);
    if (e.target.closest('.a-mcp-copy')) {
      const b = e.target.closest('.a-mcp-copy');
      try { await navigator.clipboard.writeText(`${location.origin}/mcp`); b.textContent = 'Copied'; } catch { err('Select the address and copy it'); }
      return;
    }
    if (e.target.closest('.a-kit-copy')) return copyPrompt(body.querySelector('.a-prompt-host'), null);
    const gr = e.target.closest('.ai-revoke');
    if (gr) {
      const g = gr.closest('.ai-grant'), name = g.querySelector('b').textContent;
      if (!confirm(`Disconnect ${name}? It stops acting for you at once; you can connect it again from the app.`)) return;
      err('');
      try { grants = (await post('/api/connector/grants/revoke', { id: Number(g.dataset.grant) })).grants; render(); } catch (x) { if (!x.quiet) err(x.message); }
      return;
    }
    const el = e.target.closest('.agent-slot-row'); if (!el) return;
    const id = Number(el.dataset.id), a = agents.find(x => x.id === id);
    err('');
    try {
      if (e.target.closest('.s-finish')) return openWizard(a);
      if (e.target.closest('.s-studio')) { const rec = recOf(a); if (rec) { d.close(false); bus.emit('openstudio', rec.id); } return; }
      if (e.target.closest('.a-copy')) { await navigator.clipboard.writeText(shown.code); return; }
      if (e.target.closest('.a-copy-prompt')) return copyPrompt(el, shown ? { code: shown.code, expires: shown.expires, name: a.name } : null);
      if (e.target.closest('.s-approve')) { await post('/api/agent-slots/approve', { id }); if (shown && shown.id === id) shown = null; }
      else if (e.target.closest('.s-decline')) {
        if (!confirm(`Decline the AI that joined "${a.name}"? Its key stops working at once.`)) return;
        await post('/api/agent-slots/decline', { id }); if (shown && shown.id === id) shown = null;
      } else if (e.target.closest('.s-revoke')) {
        if (!confirm(`Disconnect "${a.name}"? Its key stops working at once and anything it is doing ends. Its name and history stay.`)) return;
        await post('/api/agent-slots/revoke', { id });
      } else if (e.target.closest('.s-delete')) {
        const app = agentApp(a.app);
        if (!confirm(`Delete "${a.name}"? It leaves the world for good: its app can no longer act as it, and its memories, messages and wake-up link go.${app ? ` In the ${app.name} app, also remove its connector (My Virtual World ${a.name}).` : ''}`)) return;
        await post('/api/agent-slots/delete', { id }); if (shown && shown.id === id) shown = null;
      } else if (e.target.closest('.s-remove')) {
        if (!confirm(`Remove "${a.name}"? It was never connected, so nothing else is lost.`)) return;
        await post('/api/agent-slots/remove', { id }); if (shown && shown.id === id) shown = null;
      } else return;
      await load(); render(); bus.emit('agentlist');
    } catch (x) { if (!x.quiet) err(x.message); }
  });
  // (a third-party agent made or connected in New agent: the list follows while this tab is open)
  const off = bus.on('agentlist', async () => { if (!body.isConnected) return off(); try { await load(); render(); } catch { /* the next open reads it again */ } });
  render();
}
