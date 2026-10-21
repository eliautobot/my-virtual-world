// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Agent Studio's Brain and Free Will tabs (ui/agent-studio.js; docs/features/FREE-WILL.md §9).
// - Brain: what it thinks with (its connection, when that is a Model provider: the Mind plans its days, reflects at night
//   and chats), switching to another brain, connecting a new one with an API key, changing a brain's model, the Mind's
//   switch, this month's thinking and its cost, and every thought. What it can do, in one list. (Its voice is a tab of its
//   own: ui/agent-studio.js voiceTab.)
// - Free Will: the switch, spontaneity, its decision service, today's numbers and "Why it chose".
// The server decides who may do what; these only ask (an agent's connection: its manager, with the right to use that
// connection; a connection's model: whoever manages the connection).
import { auth } from '../core/auth.js';
import { getJSON } from '../core/net.js';
import { esc, clamp } from '../core/util.js';
import { isExt, stateOf } from '../core/agent-view.js';
import { mountSlotControls } from './agent-slots.js';
import { agentApp } from '/shared/agent-apps.js';
import { load as reloadAgents } from '../core/agents.js';
import { bus } from '../core/state.js';
import { REASON, usd as usdM, ago, gist, thoughtsHtml, problemsHtml } from './mind.js';
import { STATUS, row as whyRow, spontWord, usd as usdF } from './free-will.js';

const PROVIDERS = {
  openrouter: { label: 'OpenRouter', icon: 'OR', models: ['deepseek/deepseek-v4.1-flash', 'qwen/qwen3.6-35b-a3b', 'openai/gpt-oss-120b', 'google/gemini-3.1-flash-lite'], hint: 'One key, hundreds of models; it reports what each thought costs. Recommended: deepseek/deepseek-v4.1-flash (fast, in character, about $0.15 a month per agent).' },
  openai: { label: 'OpenAI', icon: 'O', models: [], hint: 'Your OpenAI API key and one of its chat models.' },
  anthropic: { label: 'Anthropic', icon: 'A', models: [], hint: 'Your Anthropic API key and one of its Claude models.' },
  google: { label: 'Google', icon: 'G', models: [], hint: 'Your Google AI Studio key and one of its Gemini models.' },
  custom: { label: 'Other (OpenAI-compatible)', icon: '⚙', models: [], hint: 'Any server that speaks the OpenAI chat API, at a public https address.' },
};
const prov = p => PROVIDERS[p] || PROVIDERS.custom;
const KIND_NAME = { openclaw: 'OpenClaw', hermes: 'Hermes', claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', agentapi: 'its own computer (connected agent)', universal: 'an agent server', models: 'a model provider' };

// ------------------------------------------------------------------------------------------------ Overview cards
export function brainSummary(C, mind) {
  // a connected agent thinks with its own AI, on its own platform: the world hands it what it sees and its messages
  if (isExt(C.rec())) return '<div class="st-big">Its own AI</div><div class="st-sub">A connected agent: it thinks on its own platform and acts through the world\'s door for outside AIs</div>';
  const st = mind.status, b = st.brain, on = mind.settings.cadence !== 'off';
  const big = b ? (b.own ? esc(b.label) : 'The world\'s brain') : 'No brain yet';
  const sub = !on ? 'Mind switched off' : st.thinks ? (b.own ? `${esc(b.model || b.provider)} · plans, reflects, chats` : 'Reflects each night') : esc(REASON[st.reason] || st.reason || '');
  const last = mind.thoughts?.[0];
  return `<div class="st-big">${big}</div><div class="st-sub">${sub}</div>${b && on ? `<div class="st-sub">${mind.usage.month.thoughts} thoughts this month · ${usdM(mind.usage.month.cost)}</div>` : ''}${last ? `<div class="st-mini-quote">${gist(last)}</div>` : ''}`;
}
export function freeWillSummary(fw) {
  const s = fw.settings, last = (fw.decisions || []).find(d => d.outcome === 'chosen');
  return `<div class="st-big">${s.enabled ? (fw.status.active ? 'Decides for itself' : 'On, waiting') : 'Follows its routine'}</div>
    <div class="st-sub">${s.enabled ? `${esc(spontWord(s.spontaneity))} · ${fw.today.requests} decisions today` : 'Switch it on to let it choose'}</div>
    ${last ? `<div class="st-mini-quote">✓ ${esc(last.label || '')}${last.place ? ` <span class="dim">· ${esc(last.place)}</span>` : ''}</div>` : ''}`;
}

// ------------------------------------------------------------------------------------------------ Brain
export async function brainTab(C, body, live) {
  const st = C.st.brain = C.st.brain || { form: null, edit: null, more: true, list: null };
  const [mind, conns, fw, econ, probs, slot] = await Promise.all([auth.can('agents.mind') ? C.get('mind') : null, C.get('conns'), C.i >= 0 && auth.can('agents.freewill') ? C.get('fw') : null, C.get('econ'), auth.can('agents.mind') ? C.get('problems') : null, isExt(C.rec()) ? C.get('slot') : null]);
  if (!live()) return;
  const r = C.rec(), linked = r.connection || null;
  const brains = (conns && !conns.error ? conns.connections : []).filter(c => c.kind === 'models');
  const curBrain = linked?.kind === 'models' ? brains.find(c => c.id === linked.id) || { id: linked.id, label: linked.label, kind: 'models', brain: mind?.status?.brain, enabled: linked.enabled } : null;
  if (!st.list && mind && !mind.error) st.list = mind.thoughts || [];
  const ok = x => x && !x.error;

  // the hero: what it thinks with
  let hero;
  if (curBrain) {
    const b = curBrain.brain || {}, P = prov(b.provider);
    hero = `<div class="sb-hero"><div class="sb-orb" aria-hidden="true"><span>${P.icon}</span></div><div class="sb-hero-t"><small>It thinks with</small><h3>${esc(curBrain.label)}</h3>
      <div class="sb-tags"><span class="st-pill">${esc(P.label)}</span>${b.model ? `<span class="st-pill mono">${esc(b.model)}</span>` : ''}${b.thinking && b.thinking !== 'off' ? `<span class="st-pill">thinking ${esc(b.thinking)}</span>` : ''}<span class="st-pill">${curBrain.scope === 'account' ? 'Your own' : 'Shared'}</span>${dot(curBrain)}</div></div></div>`;
  } else if (isExt(r)) {
    // (a third-party agent: the app it lives as - its logo when its owner sees which app it is)
    const xa = ok(slot) ? agentApp(slot.app) : null;
    hero = `<div class="sb-hero"><div class="sb-orb other" aria-hidden="true">${xa ? `<span class="na-logo na-md" style="background:${esc(xa.tile)}"><img src="${esc(xa.logo)}" alt="" draggable="false"></span>` : '<span>💻</span>'}</div><div class="sb-hero-t"><small>It thinks with</small><h3>${esc(xa ? xa.name : 'Its own AI')}</h3><p class="hint">A third-party agent brings its own AI. Its connection, who sees it and who may chat with it are below.</p></div></div>`;
  } else if (linked) {
    hero = `<div class="sb-hero"><div class="sb-orb other" aria-hidden="true"><span>🔌</span></div><div class="sb-hero-t"><small>It thinks with</small><h3>${esc(linked.label)}</h3>
      <div class="sb-tags"><span class="st-pill">${esc(KIND_NAME[linked.kind] || linked.kind)}</span></div><p class="hint">Its chats go to ${esc(KIND_NAME[linked.kind] || 'that connection')}. Give it a brain below to let the world's Mind plan its days and reflect.</p></div></div>`;
  } else {
    hero = `<div class="sb-hero"><div class="sb-orb none" aria-hidden="true"><span>💤</span></div><div class="sb-hero-t"><small>It thinks with</small><h3>No brain of its own yet</h3><p class="hint">${ok(mind) && mind.status.brain ? `The world's brain (${esc(mind.status.brain.label)}) gives it a reflection each night. ` : ''}Choose a brain below, or connect one with an API key, and it plans its days, reflects and chats.</p></div></div>`;
  }

  // the Mind
  let mindHtml = '';
  if (ok(mind)) {
    const ms = mind.status, on = mind.settings.cadence !== 'off', u = mind.usage;
    const used = u.limits.monthlyMicro ? clamp(u.month.cost / u.limits.monthlyMicro, 0, 1) : 0;
    mindHtml = `<div class="st-sec"><div class="st-sec-h"><h4>💡 Its Mind</h4>${toggle('mind-on', on, 'Plans and reflects each day')}</div>
      <p class="hint${on && !ms.thinks ? ' warn' : ''}">${!on ? esc(REASON.switched_off) : ms.thinks ? (ms.brain?.own ? 'It plans its day when it wakes, reflects on it at bedtime and answers its chats.' : 'It reflects on its day at bedtime with the world\'s brain.') : esc(REASON[ms.reason] || ms.reason)}</p>
      ${ms.brain && on ? `<div class="sb-usage"><div class="sb-usage-t"><span>This month</span><b>${u.month.thoughts} thought${u.month.thoughts === 1 ? '' : 's'} · ${usdM(u.month.cost)}</b><small>of ${usdM(u.limits.monthlyMicro)}</small></div><div class="st-meter"><i style="width:${Math.max(2, Math.round(used * 100))}%"></i></div></div>
      <div class="row wrap">${ms.does.includes('plan') ? '<button type="button" class="btn small" data-k="plan">☀ Plan its day now</button>' : ''}${ms.does.includes('reflect') ? '<button type="button" class="btn small" data-k="reflect">🌙 Reflect now</button>' : ''}<span class="sb-thinking hint hidden">Thinking…</span></div>` : ''}</div>`;
  }

  // choosing a brain
  let choose = '';
  if (C.manage && !isExt(r)) {
    const others = brains.filter(c => c.id !== curBrain?.id);
    choose = `<div class="st-sec"><div class="st-sec-h"><h4>🔄 Choose its brain</h4></div>
      ${brains.length ? `<div class="sb-grid">${brains.map(c => brainCard(c, c.id === curBrain?.id)).join('')}
        ${linked ? `<div class="sb-card none"><div class="sb-card-h"><span class="sb-ic">💤</span><b>No brain of its own</b></div><p class="hint">${linked.kind === 'models' ? 'Its Mind stops planning and chatting; the world\'s brain may still reflect each night.' : `It stops using ${esc(linked.label)}.`}</p><button type="button" class="btn small" data-use="">Unlink</button></div>` : ''}</div>`
        : '<p class="hint">No brains you may use yet. Connect one below with an API key.</p>'}
      ${linked && linked.kind !== 'models' && others.length ? `<p class="hint warn">Choosing a model provider replaces ${esc(linked.label)}: its chats go to the new brain.</p>` : ''}</div>`;
  }

  // connecting a new brain
  let add = '';
  if (C.manage && !isExt(r) && auth.can('connections.use')) {
    const f = st.form || { provider: 'openrouter', model: PROVIDERS.openrouter.models[0], open: !brains.length };
    st.form = f;
    const P = prov(f.provider);
    add = `<details class="st-sec sb-new"${f.open ? ' open' : ''}><summary><h4>➕ Connect a new brain</h4><span class="hint">Paste an API key - it stays sealed on the server and is never shown again.</span></summary>
      <form class="sb-form" autocomplete="off">
        <div class="sb-provs" role="radiogroup" aria-label="Provider">${Object.entries(PROVIDERS).map(([k, v]) => `<button type="button" class="sb-prov${f.provider === k ? ' on' : ''}" data-prov="${k}" role="radio" aria-checked="${f.provider === k}"><span>${v.icon}</span>${esc(v.label)}</button>`).join('')}</div>
        <p class="hint">${esc(P.hint)}</p>
        <div class="sb-fields">
          <label>Model<input class="input mono" name="model" list="sb-models" maxlength="120" spellcheck="false" placeholder="${f.provider === 'openrouter' ? 'deepseek/deepseek-v4.1-flash' : 'the model\'s name at your provider'}" value="${esc(f.model || '')}"><datalist id="sb-models">${P.models.map(m => `<option value="${esc(m)}">`).join('')}</datalist></label>
          ${f.provider === 'custom' ? `<label>Address (https)<input class="input mono" name="baseUrl" maxlength="300" spellcheck="false" placeholder="https://my-server.example.com/v1" value="${esc(f.baseUrl || '')}"></label>` : ''}
          <label>API key<input class="input mono" name="apiKey" type="password" autocomplete="new-password" spellcheck="false" maxlength="4000" placeholder="${f.pending ? 'set - paste again to replace' : 'sk-…'}"></label>
          <label>Name<input class="input" name="label" maxlength="60" placeholder="My ${esc(P.label)} brain" value="${esc(f.label || '')}"></label>
          <details class="sb-adv"><summary class="hint">Prices, for its monthly budget${f.provider === 'openrouter' ? ' (OpenRouter reports them itself: leave 0)' : ''}</summary>
            <div class="sb-two"><label>US$ per million tokens in<input class="input" name="priceIn" inputmode="decimal" value="${esc(f.priceIn ?? '0')}"></label><label>US$ per million tokens out<input class="input" name="priceOut" inputmode="decimal" value="${esc(f.priceOut ?? '0')}"></label></div></details>
        </div>
        <div class="sb-steps">${['Save', 'Test', `Give it to ${esc(C.name)}`].map((s, k) => `<span class="sb-step" data-step="${k}"><i>${k + 1}</i>${s}</span>`).join('')}</div>
        <div class="row end"><button type="submit" class="btn primary">🔌 Connect and use it</button></div>
      </form></details>`;
  }

  // what it can do
  const can = [];
  if (ok(mind)) {
    const ms = mind.status;
    can.push([ms.thinks && ms.does.includes('plan'), '☀ Plans its own day each morning']);
    can.push([ms.thinks && ms.does.includes('reflect'), '🌙 Reflects on its day at night, and remembers']);
    can.push([ms.thinks && ms.does.includes('problems'), '🧭 Deals with problems - rent, money, a home, a job - within your spending rules']);
    can.push([ms.thinks && ms.does.includes('speech'), '🗣️ Says its own words when people talk to it - every line checked by moderation first']);
  }
  can.push([!!(linked && linked.kind !== 'openai-decisions') || isExt(r), '💬 Chats with you']);
  if (ok(fw)) can.push([fw.settings.enabled && fw.status.active, '⚡ Decides for itself what it does (Free Will)']);
  const wallet = ok(econ) ? econ.agents.find(a => a.id === C.id) : null;
  if (wallet) can.push([!wallet.limits.paused && wallet.limits.scopes.length > 0, `👛 Uses money${wallet.limits.scopes.length ? `: ${wallet.limits.scopes.join(', ')}` : ''}`]);
  const canHtml = `<div class="st-sec"><div class="st-sec-h"><h4>✅ What it can do</h4></div><ul class="sb-can">${can.map(([y, t]) => `<li class="${y ? 'y' : 'n'}"><span>${y ? '✓' : '–'}</span>${esc(t)}</li>`).join('')}</ul></div>`;

  // its thoughts
  const thoughts = ok(mind) ? `<div class="st-sec"><div class="st-sec-h"><h4>📒 Its thoughts</h4><small class="dim">${ok(mind) && mind.thoughts?.[0] ? `latest ${ago(mind.thoughts[0].at)}` : ''}</small></div>
    <div class="lib-list mind-list">${thoughtsHtml(st.list || [], C.name)}</div>${st.more && (st.list || []).length >= 10 ? '<div class="row"><button type="button" class="btn small" data-c="older">Older thoughts</button></div>' : ''}</div>` : '';

  // its problems: what is wrong now and what its Mind did about it, then what was solved lately
  const plist = ok(probs) ? probs.problems : [];
  const problems = ok(probs) && C.i >= 0 ? `<div class="st-sec"><div class="st-sec-h"><h4>🧭 Problems</h4><small class="dim">${plist.some(p => p.status === 'open') ? '' : 'nothing wrong now'}</small></div>
    ${plist.length ? `<div class="mp-list">${problemsHtml(plist)}</div>` : `<p class="hint">When something goes wrong - rent it can't pay, money running out, no home or no job - it shows here, you are told, and ${esc(C.name)} deals with it${ok(mind) && mind.status.does.includes('problems') ? ' with its Mind' : ' (with a brain of its own, its Mind would)'}.</p>`}</div>` : '';

  const connHtml = isExt(r) ? connectionHtml(C, ok(slot) ? slot : null) : '';
  body.innerHTML = `<div class="sb">${hero}${connHtml}${problems}${mindHtml}${choose}${add}${canHtml}${thoughts}</div>`;
  wireBrain(C, body, { st, mind, brains, curBrain, linked });
  if (connHtml) wireConnection(C, body, ok(slot) ? slot : null);
}

// ------------------------------------------------------------------------------------------------ A third-party agent's connection
// How it is connected, seen from the Studio: its owner sees which app it is (its logo), the key when it uses the kit,
// since when, from how many addresses, approves, declines or disconnects it here (each asks for the password again:
// routes.js reauth), and sets everything else about it (ui/agent-slots.js mountSlotControls: who sees it, who may chat
// with it, its wake-up link, reports). A person it is shared with to manage sees only whether it is connected.
const CONN_STATE = { waiting: ['idle', 'Waiting for your OK'], approved: ['ok', 'Connected'], pending: ['off', 'Not connected yet'], revoked: ['bad', 'Disconnected'] };
function connectionHtml(C, s) {
  const r = C.rec(), live = stateOf(r);
  if (!s) {
    return `<div class="st-sec sb-conn" data-testid="studio-connection"><div class="st-sec-h"><h4>🔒 Its connection</h4><span class="st-pill${live.live ? ' on' : ''}">${esc(live.label)}</span></div>
      <p class="hint">Its owner holds its connection: only they approve a new one, give it a new code or disconnect it.</p></div>`;
  }
  const [cls, text] = CONN_STATE[s.approval || s.status] || ['idle', s.status];
  const since = s.approvedAt || s.enrolledAt, app = agentApp(s.app);
  const facts = [
    `<li><span>Through</span><b>${esc(app ? app.name : s.via === 'key' ? 'the command-line kit' : 'an AI app (MCP)')}</b></li>`,
    s.fingerprint ? `<li><span>Key</span><code>${esc(String(s.fingerprint).slice(0, 16))}</code></li>` : '',
    since ? `<li><span>${s.approvedAt ? 'Connected since' : 'Joined'}</span><b>${esc(new Date(since).toLocaleString())}</b></li>` : '',
    s.lastSeen ? `<li><span>Last seen</span><b>${esc(ago(s.lastSeen))}</b></li>` : '',
    s.addresses ? `<li><span>Signed in from</span><b>${s.addresses} address${s.addresses === 1 ? '' : 'es'}</b></li>` : '',
  ].join('');
  const waiting = s.approval === 'waiting' ? `<p class="hint warn">An AI joined it with its code. Approve it only if you just gave the code to your own AI and it tells you the same key; if not, decline it and its key stops working at once.</p>
      <div class="row wrap"><button type="button" class="btn small primary" data-cn="approve" data-testid="studio-approve">Approve</button><button type="button" class="btn small danger" data-cn="decline">Decline</button></div>` : '';
  const again = s.status !== 'active' && app ? `<button type="button" class="btn small primary" data-cn="connect">Connect it to ${esc(app.name)}</button>` : '';
  return `<div class="st-sec sb-conn" data-testid="studio-connection"><div class="st-sec-h"><h4>${app ? `<span class="na-logo na-sm" style="background:${esc(app.tile)}"><img src="${esc(app.logo)}" alt="" draggable="false"></span>` : '🔒'} Its connection</h4><span class="sb-dot ${cls}"><i></i>${esc(text)}</span>${s.approval === 'approved' ? `<span class="st-pill${s.online ? ' on' : ''}">${s.online ? 'Online' : 'Offline'}</span>` : ''}</div>
      <ul class="sb-facts">${facts}</ul>${waiting}
      <div class="row wrap">${again}${s.status === 'active' && s.approval === 'approved' ? '<button type="button" class="btn small danger" data-cn="disconnect">Disconnect</button>' : ''}
        <button type="button" class="btn small danger" data-cn="delete" data-testid="studio-delete">Delete this agent</button></div>
      <div class="sb-slot"></div>
      <p class="hint">Only you see this.</p></div>`;
}
function wireConnection(C, body, s) {
  const after = async () => { C.drop('slot'); await reloadAgents(); C.repaint(); };
  if (s) { const host = body.querySelector('.sb-slot'); if (host) mountSlotControls(host, s, { onChange: (fresh, { replaced }) => { C.cache.set('slot', Promise.resolve(fresh)); if (replaced && C.tab === 'brain') C.repaint(); } }); }
  for (const b of body.querySelectorAll('[data-cn]')) b.onclick = async () => {
    const k = b.dataset.cn;
    if (!s) return;
    if (k === 'connect') { (await import('./new-agent.js')).openNewAgent(C.app, { slot: s }); return; }
    if (k === 'approve') { if (await C.call('/api/agent-slots/approve', { id: s.id }, 'Connection approved')) await after(); return; }
    if (k === 'delete') {
      // (2026-10-13: deleting the Bot in its own app leaves the agent here, still connected: this is how it goes)
      const where = app => app ? ` In the ${app.name} app, also remove its connector (My Virtual World ${s.name}).` : '';
      if (!confirm(`Delete ${s.name}? It leaves the world for good: its app can no longer act as it, and its memories, messages and wake-up link go.${where(agentApp(s.app))}`)) return;
      if (await C.call('/api/agent-slots/delete', { id: s.id }, `${s.name} was deleted`)) { (await import('./agent-studio.js')).close(); await reloadAgents().catch(() => {}); bus.emit('agentlist'); }
      return;
    }
    if (k === 'decline' && !C.armed(b, 'Tap again to decline')) return;
    if (k === 'disconnect' && !C.armed(b, 'Tap again: its key stops working')) return;
    if (await C.call(`/api/agent-slots/${k === 'decline' ? 'decline' : 'revoke'}`, { id: s.id }, k === 'decline' ? 'Declined: its key no longer works' : 'Disconnected')) await after();
  };
}

function dot(c) {
  const s = c.status;
  const [cls, t] = !c.enabled ? ['off', 'switched off'] : !s ? ['idle', 'not tested'] : s.ok ? ['ok', 'working'] : ['bad', s.error || 'not working'];
  return `<span class="sb-dot ${cls}" title="${esc(t)}"><i></i>${esc(t)}</span>`;
}
function brainCard(c, on) {
  const b = c.brain || {}, P = prov(b.provider), mine = c.level === 'manage';
  return `<div class="sb-card${on ? ' on' : ''}" data-id="${c.id}"><div class="sb-card-h"><span class="sb-ic">${P.icon}</span><b>${esc(c.label)}</b>${dot(c)}</div>
    <div class="sb-model mono" title="${esc(b.model || '')}">${esc(b.model || P.label)}</div>
    <small class="dim">${esc(P.label)} · ${c.scope === 'account' ? 'yours' : 'shared'}</small>
    <div class="row wrap">${on ? '<span class="st-pill on">✓ Its brain</span>' : `<button type="button" class="btn small primary" data-use="${c.id}"${c.enabled ? '' : ' disabled'}>Use this brain</button>`}
      ${mine ? `<button type="button" class="btn small" data-edit="${c.id}">Model…</button><button type="button" class="btn small" data-test="${c.id}">Test</button>` : ''}</div>
    <div class="sb-edit hidden"><input class="input mono small" maxlength="120" spellcheck="false" value="${esc(b.model || '')}" aria-label="Model"><button type="button" class="btn small primary" data-save-model="${c.id}">Save</button><small class="dim">Every agent using this brain changes with it.</small></div>
    <div class="sb-out hint hidden" aria-live="polite"></div></div>`;
}
const toggle = (cls, on, label) => `<label class="st-switch"><input type="checkbox" class="${cls}"${on ? ' checked' : ''}><span class="st-knob"></span><span>${esc(label)}</span></label>`;

function wireBrain(C, body, { st, brains }) {
  const q = s => body.querySelector(s);
  const after = async () => { C.drop('mind', 'conns'); await reloadAgents(); C.repaint(); };
  const on = q('.mind-on');
  if (on) on.onchange = async () => { if (await C.call('/api/mind/agent', { agent: C.id, cadence: on.checked ? 'daily' : 'off' }, on.checked ? 'Its Mind is on' : 'Its Mind is off')) { st.list = null; await after(); } else on.checked = !on.checked; };
  body.querySelectorAll('[data-k]').forEach(b => {
    b.onclick = async () => {
      body.querySelectorAll('[data-k]').forEach(x => { x.disabled = true; }); q('.sb-thinking')?.classList.remove('hidden'); C.pose('idle_hold', 'book');
      const r = await C.call('/api/mind/think', { agent: C.id, kind: b.dataset.k }, b.dataset.k === 'plan' ? `${C.name} planned its day` : `${C.name} reflected on its day`);
      if (r) { st.list = null; C.drop('life'); }
      await after();
    };
  });
  body.querySelectorAll('[data-use]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.use ? Number(b.dataset.use) : null;
      if (id === null && !C.armed(b, 'Tap again to unlink')) return;
      const c = brains.find(x => x.id === id);
      if (await C.call('/api/agents/update', { id: C.id, connectionId: id }, id ? `${C.name} now thinks with ${c?.label || 'that brain'}` : `${C.name} has no brain of its own now`)) { st.list = null; await after(); }
    };
  });
  body.querySelectorAll('[data-edit]').forEach(b => { b.onclick = () => { const e = b.closest('.sb-card').querySelector('.sb-edit'); e.classList.toggle('hidden'); e.querySelector('input').focus(); }; });
  body.querySelectorAll('[data-save-model]').forEach(b => {
    b.onclick = async () => {
      const m = b.closest('.sb-edit').querySelector('input').value.trim();
      if (!m) return C.say('Which model?', true);
      if (await C.call('/api/connections/update', { id: Number(b.dataset.saveModel), config: { model: m } }, `Model changed to ${m}`)) await after();
    };
  });
  body.querySelectorAll('[data-test]').forEach(b => {
    b.onclick = async () => {
      const out = b.closest('.sb-card').querySelector('.sb-out'); out.classList.remove('hidden'); out.textContent = 'Testing…';
      const r = await C.call('/api/connections/test', { id: Number(b.dataset.test) });
      out.textContent = !r ? 'Could not test it' : r.ok === false ? `✗ ${r.error || 'Not working'}${r.fix ? ` - ${r.fix}` : ''}` : `✓ ${r.detail || 'Working'}`;
      C.drop('conns');
    };
  });
  const older = q('[data-c="older"]');
  if (older) older.onclick = async () => {
    const last = st.list[st.list.length - 1];
    try { const r = (await getJSON(`/api/mind/thoughts?agent=${C.id}&limit=30&before=${last ? last.id : ''}`)).thoughts; st.list = st.list.concat(r); st.more = r.length >= 30; C.repaint(); } catch (e) { C.say(e.message, true); }
  };
  // a new brain: save it, test it, give it to the agent
  const form = q('.sb-form');
  if (!form) return;
  const f = st.form;
  q('.sb-new').ontoggle = e => { f.open = e.target.open; };
  const keep = () => { const d = new FormData(form); for (const k of ['model', 'baseUrl', 'label', 'priceIn', 'priceOut']) if (d.has(k)) f[k] = String(d.get(k)); };
  form.querySelectorAll('[data-prov]').forEach(b => { b.onclick = () => { keep(); f.provider = b.dataset.prov; f.model = prov(f.provider).models[0] || ''; f.pending = null; C.repaint(); }; });
  const step = (k, state) => { const s = form.querySelector(`[data-step="${k}"]`); s.classList.remove('run', 'done', 'fail'); if (state) s.classList.add(state); };
  form.onsubmit = async e => {
    e.preventDefault(); keep();
    const d = new FormData(form), key = String(d.get('apiKey') || '').trim(), model = String(d.get('model') || '').trim();
    if (!model) return C.say('Which model should it think with?', true);
    if (!key && !f.pending) return C.say('Paste the API key from your provider.', true);
    const num = v => { const n = Number(String(v || '0').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : 0; };
    const config = { provider: f.provider, model, thinking: 'off', priceInPerMTok: num(f.priceIn), priceOutPerMTok: num(f.priceOut) };
    if (f.provider === 'custom') config.baseUrl = String(d.get('baseUrl') || '').trim();
    const label = String(d.get('label') || '').trim() || `My ${prov(f.provider).label} brain`;
    form.querySelector('[type=submit]').disabled = true;
    step(0, 'run');
    const saved = f.pending ? await C.call('/api/connections/update', { id: f.pending, label, config, secrets: key ? { apiKey: key } : undefined })
      : await C.call('/api/connections', { kind: 'models', label, scope: 'account', config, secrets: { apiKey: key } });
    if (!saved) { step(0, 'fail'); form.querySelector('[type=submit]').disabled = false; return; }
    f.pending = saved.id; step(0, 'done'); step(1, 'run');
    const t = await C.call('/api/connections/test', { id: saved.id });
    if (!t || t.ok === false) {
      step(1, 'fail'); form.querySelector('[type=submit]').disabled = false;
      C.say(`Saved, but the test failed: ${t?.error || 'no answer'}${t?.fix ? ` - ${t.fix}` : ''}. Fix it and press Connect again.`, true);
      C.drop('conns'); return;
    }
    step(1, 'done'); step(2, 'run');
    if (!await C.call('/api/agents/update', { id: C.id, connectionId: saved.id }, `🧠 ${C.name} now thinks with ${label}`)) { step(2, 'fail'); form.querySelector('[type=submit]').disabled = false; return; }
    step(2, 'done');
    st.form = null; st.list = null;
    await after();
  };
}

// ------------------------------------------------------------------------------------------------ Free Will
export async function freeWillTab(C, body, live) {
  const st = C.st.fw = C.st.fw || { list: null, more: true };
  const v = await C.get('fw');
  if (!live()) return;
  if (!v || v.error) { body.innerHTML = `<p class="hint">${esc(v?.error || 'Free Will is not available for this agent.')}</p>`; return; }
  if (!st.list) { st.list = v.decisions || []; st.more = st.list.length >= 20; }
  const s = v.settings, active = !!v.status.active;
  const word = spontWord(s.spontaneity);
  const svc = v.services.length ? `<label class="sf-svc">Decision service<select class="input fw-svc"><option value="">The world's default${v.services.find(x => x.isDefault) ? ` (${esc(v.services.find(x => x.isDefault).label)})` : ''}</option>
      ${v.services.map(x => `<option value="${x.id}"${s.connectionId === x.id ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>` : '';
  const chosen = st.list.filter(d => d.outcome === 'chosen').length;
  body.innerHTML = `<div class="sf">
    <div class="sf-hero${s.enabled ? ' on' : ''}"><div class="sf-bolt" aria-hidden="true">⚡</div><div class="sf-hero-t"><h3>${s.enabled ? 'It decides for itself' : 'It follows its routine'}</h3>
      <p class="hint${s.enabled && !active ? ' warn' : ''}">${esc(s.enabled ? (STATUS[v.status.reason] || (active ? STATUS.active : v.status.reason)) : STATUS.switched_off)}</p></div>
      ${toggle('fw-on', s.enabled, s.enabled ? 'On' : 'Off')}</div>
    ${s.enabled ? `<div class="st-sec"><div class="st-sec-h"><h4>🎲 Spontaneity</h4><b class="sf-word">${esc(word)}</b></div>
      <input type="range" class="sf-range fw-sp" min="0" max="1" step="0.05" value="${s.spontaneity}" aria-label="Spontaneity">
      <div class="sf-scale"><span>Predictable</span><span>Steady</span><span>Balanced</span><span>Adventurous</span><span>Impulsive</span></div>
      <p class="hint">How often it picks something other than its most likely choice - full on free time, less on meals and mornings, little on how it works.</p></div>
    <div class="st-sec"><div class="sf-tiles"><div class="sf-tile"><b>${v.today.requests}</b><span>asked today</span></div><div class="sf-tile"><b>${v.today.chosen}</b><span>chosen by it</span></div><div class="sf-tile"><b>${usdF(v.today.costMicro)}</b><span>cost today</span></div><div class="sf-tile"><b>${st.list.length ? Math.round(chosen / st.list.length * 100) : 0}%</b><span>its own pick, lately</span></div></div>${svc}</div>
    <div class="st-sec"><div class="st-sec-h"><h4>❓ Why it chose</h4><button type="button" class="btn small" data-c="refresh">Refresh</button></div>
      <ol class="fw-list">${st.list.map(whyRow).join('') || '<li class="hint">Nothing yet: its next choice shows here.</li>'}</ol>
      ${st.more ? '<div class="row"><button type="button" class="btn small" data-c="older">Older</button></div>' : ''}</div>` : `<div class="st-sec"><p class="hint">With Free Will on, a decision service picks what ${esc(C.name)} does - free time, meals, mornings, the way to work, rest, how it works on a task - from the real places and prices around it, its character, plans and memories. Only sleep stays with its routine. It costs about $0.15–0.25 a month for an agent.</p></div>`}
  </div>`;
  const q = sel => body.querySelector(sel);
  const save = async (patch, msg) => { const r = await C.call('/api/free-will/agent', { agent: C.id, ...patch }, msg); C.drop('fw'); if (r) { st.list = null; } C.repaint(); };
  q('.fw-on').onchange = e => save({ enabled: e.target.checked }, e.target.checked ? `⚡ ${C.name} decides for itself` : `${C.name} follows its routine`);
  const sp = q('.fw-sp');
  if (sp) { let t = 0; sp.oninput = () => { q('.sf-word').textContent = spontWord(+sp.value); clearTimeout(t); t = setTimeout(() => save({ spontaneity: +sp.value }), 500); }; }
  const sv = q('.fw-svc');
  if (sv) sv.onchange = () => save({ connectionId: sv.value ? Number(sv.value) : null }, 'Decision service saved');
  const rf = q('[data-c="refresh"]');
  if (rf) rf.onclick = () => { C.drop('fw'); st.list = null; C.repaint(); };
  const older = q('[data-c="older"]');
  if (older) older.onclick = async () => {
    const last = st.list[st.list.length - 1];
    try { const r = (await getJSON(`/api/free-will/decisions?agent=${C.id}&limit=20&before=${last ? last.id : ''}`)).decisions; st.list = st.list.concat(r); st.more = r.length >= 20; C.repaint(); } catch (e) { C.say(e.message, true); }
  };
}
