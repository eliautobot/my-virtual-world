// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Mind in the UI (docs/features/FREE-WILL.md §9).
// - An agent's Mind (whether it plans and reflects, with which brain, its thoughts and what they cost, "Plan now" /
//   "Reflect now") is the Agent Studio's Brain tab (ui/studio-mind.js); the words and the thought list it shows are here:
//   every thought — what it planned, remembered, noted about people, how it changed, what it felt — with its cost.
// - An agent's problems (rent it couldn't pay, money running out, no home, no job: server/mind/problems.js) — its owner is
//   told when one opens, when its Mind did something about it, and when it is solved; the Studio lists them.
// - Settings → Free Will (freewill.admin): the Mind's switch, the world's brain for agents without their own, the limits,
//   and today at a glance.
import { auth } from '../core/auth.js';
import { getJSON } from '../core/net.js';
import { esc } from '../core/util.js';
import { bus } from '../core/state.js';

let app = null;
export function init(a) {
  app = a;
  bus.on('msg:mind', onNote);
}
/** What the server tells an agent's owner: a problem opened, its Mind's word to them, a problem solved. */
function onNote(m) {
  const who = `${m.agent?.name || 'Your agent'}`;
  if (m.ev === 'problem') app?.toast?.(`${PROBLEM[m.kind]?.[0] || '⚠️'} ${who}: ${m.text}`, 'bad', 6500);
  else if (m.ev === 'note') app?.toast?.(`💬 ${who}: “${m.text}”`, '', 7000);
  else if (m.ev === 'solved') app?.toast?.(`✅ ${who}: ${m.text}`, 'good', 5200);
  bus.emit('mind:problems', m.agent?.id);
}

export const REASON = {
  mind_off: 'The Mind is switched off for the whole world by an administrator.',
  switched_off: 'Off — it doesn\'t plan or reflect; its routine and Free Will go on.',
  brain_off: 'Its brain (its connection) is switched off.',
  unavailable: 'Model providers are not available on this server.',
  not_allowed: 'Its owner may not use its brain connection.',
  no_brain: 'It has no brain yet. Link it to a model provider (Settings → Connections, then its connection) to let it plan its days, reflect and chat.',
  brain_paused: 'Its brain is paused after failures; it will try again in a few minutes.',
  agent_daily_limit: 'It has reached today\'s thinking limit.',
  agent_monthly_limit: 'It has used this month\'s thinking budget (it starts again on the 1st).',
  installation_daily_limit: 'The world\'s thinking budget for today is used up.',
};
export const ERR = {
  auth: 'its brain\'s key was refused', quota: 'its brain\'s account has no credit', rate_limited: 'its brain was busy', timeout: 'its brain took too long',
  network: 'its brain could not be reached', bad_request: 'its brain refused the request (check the model name)', bad_answer: 'its brain\'s answer made no sense', cut_off: 'its brain\'s answer was cut off',
  refused: 'its brain declined to answer', blocked: 'its brain\'s address is not allowed', provider_error: 'its brain failed', agent_daily_limit: 'today\'s limit was reached',
  agent_monthly_limit: 'this month\'s budget was used up', installation_daily_limit: 'the world\'s budget for today was used up', no_body: 'it had no body',
};
export const KIND = { plan: ['☀', 'Planned its day'], reflect: ['🌙', 'Reflected on its day'], chat: ['💬', 'Answered a chat'], problem: ['🧭', 'Dealt with a problem'], speech: ['🗣️', 'Spoke in public'] };
const NOT_SAID = { blocked: 'the moderation service stopped it', local: 'it broke the world\'s rules for public lines', unchecked: 'it couldn\'t be checked' };
const LOCAL_WHY = { link: 'a link', contact: 'contact details', character: 'out of character', format: 'garbled', long: 'too long', empty: 'empty' };
/** What a line said in public came to: its words, or why nobody heard it. */
const saidLine = d => (d.shown ? `“${esc(d.said || '')}”` : `Kept it to itself — ${NOT_SAID[d.moderation] || 'not said'}${d.categories?.length ? ` (${esc(d.categories.join(', '))})` : d.reason && LOCAL_WHY[d.reason] ? ` (${LOCAL_WHY[d.reason]})` : ''}`);
export const PROBLEM = { rent: ['🏠', 'Rent'], money: ['🪙', 'Money'], home: ['🛏️', 'Home'], job: ['💼', 'Job'] };
export const usd = micro => (micro >= 10000 ? `$${(micro / 1e6).toFixed(2)}` : `$${(micro / 1e6).toFixed(4)}`);
export const ago = t => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };

/** One line about a thought, for the card. */
export function gist(t) {
  if (t.status !== 'ok') return `${(KIND[t.kind] || ['•'])[0]} ${t.status === 'skipped' ? 'Skipped' : 'Could not think'} — ${esc(ERR[t.error] || t.error || 'unknown')}`;
  const d = t.did || {};
  if (t.kind === 'speech') return `${KIND.speech[0]} ${saidLine(d)}`;
  const bits = [];
  if (d.plans?.length) bits.push(`planned ${d.plans.map(p => esc(p.replace(/^(must|want): /, ''))).join('; ')}`);
  if (d.memories?.length) bits.push(`remembered ${d.memories.map(m => esc(m.replace(/^(short|long): /, ''))).join('; ')}`);
  const acts = (d.used || []).filter(u => u.say);
  if (acts.length) bits.unshift(acts.map(u => esc(u.say)).join('; '));
  if (!bits.length && d.thought) bits.push(`“${esc(d.thought)}”`);
  return `${(KIND[t.kind] || ['•'])[0]} ${bits.join(' · ') || (KIND[t.kind] || [, t.kind])[1]}`;
}
// (a step its owner has no plain words for — a look, a slip — is shown as the agent saw it)
const TOOL_WORD = { flats: 'Looked at flats', menu: 'Looked at a menu', rent_flat: 'Rent a flat', buy: 'Buy', pay: 'Pay', ask_owner: 'Ask you' };

// ------------------------------------------------------------------ an agent's problems (the Studio)
/** HTML for an agent's problems (GET /api/mind/problems): the open ones first, with what its Mind did; then lately solved. */
export function problemsHtml(list, { solved = 3 } = {}) {
  const open = list.filter(p => p.status === 'open'), done = list.filter(p => p.status !== 'open').slice(0, solved);
  const row = p => `<div class="mp-row ${p.status === 'open' ? 'open' : 'done'}"><span class="mp-ic" aria-hidden="true">${p.status === 'open' ? PROBLEM[p.kind]?.[0] || '⚠️' : '✅'}</span>
    <span class="mp-t"><b>${esc(p.text)}</b>${p.status === 'open'
    ? `<small class="dim">${ago(p.opened)}${p.note ? ` · ${esc(p.note)}` : p.thoughts ? '' : ' · not thought about yet'}</small>`
    : `<small class="dim">solved ${ago(p.resolved)}</small>`}</span></div>`;
  return open.map(row).join('') + done.map(row).join('');
}

// ------------------------------------------------------------------ the Studio's thoughts (Brain tab)
/** HTML for a list of thoughts (GET /api/mind/thoughts). */
export function thoughtsHtml(list, name) {
  if (!list.length) return `<p class="hint">No thoughts yet. With a brain, ${esc(name)} plans its day when it wakes and reflects at bedtime (a world day is 90 real minutes).</p>`;
  const li = (label, items) => (items && items.length ? `<div class="mind-did"><span class="dim">${label}</span> ${items.map(x => esc(x)).join(' · ')}</div>` : '');
  return list.map(t => {
    const [icon, title] = KIND[t.kind] || ['•', t.kind], d = t.did || {};
    const head = `<div class="row"><b>${icon} ${title}</b><small class="dim">${ago(t.at)}${t.day !== null && t.day !== undefined ? ` · world day ${t.day}` : ''}</small>
      <small class="dim">${t.cost ? usd(t.cost) : ''}${t.ms ? ` · ${(t.ms / 1000).toFixed(1)} s` : ''}</small></div>`;
    if (t.status !== 'ok') return `<div class="lib-row mind-t bad">${head}<div class="dim">${t.status === 'skipped' ? 'Skipped' : 'Could not think'}: ${esc(ERR[t.error] || t.error || 'unknown')}</div></div>`;
    if (t.kind === 'speech') return `<div class="lib-row mind-t">${head}<div class="mind-did"><span class="dim">${d.kind === 'greet' ? `To ${esc(d.to || 'someone')}, who said hello` : d.kind === 'reply' ? `Answering ${esc(d.to || 'someone')}` : `Chatting with ${esc(d.to || 'someone')}`}</span> ${saidLine(d)}</div></div>`;
    return `<div class="lib-row mind-t">${head}
      ${d.thought ? `<div class="mind-thought">“${esc(d.thought)}”</div>` : ''}
      ${li('Plans', (d.plans || []).map(p => p.replace(/^must: /, 'Must: ').replace(/^want: /, 'Wants to: ')))}${li('Done', d.done)}${li('Dropped', d.dropped)}
      ${li('Remembered', (d.memories || []).map(m => m.replace(/^long: /, '(for good) ').replace(/^short: /, '')))}${li('About people', d.people)}
      ${d.trait ? `<div class="mind-did"><span class="dim">Changed</span> ${esc(d.trait)}</div>` : ''}${d.aspiration ? `<div class="mind-did"><span class="dim">New hope</span> ${esc(d.aspiration)}</div>` : ''}
      ${li('Did', (d.used || []).map(u => u.say || `${TOOL_WORD[u.tool] || u.tool}: ${u.text}`))}${d.told ? `<div class="mind-did"><span class="dim">Told you</span> “${esc(d.told)}”</div>` : ''}
      ${t.kind === 'chat' && d.reply ? `<div class="mind-did dim">Replied (${d.reply} characters)</div>` : ''}</div>`;
  }).join('');
}

// ------------------------------------------------------------------ Settings → Free Will → The Mind (administrators)
export async function mindAdmin(d, body) {
  let O = null, S2 = null;
  const load = async () => {
    try { [O, S2] = await Promise.all([getJSON('/api/mind/overview'), getJSON('/api/settings')]); render(); }
    catch (e) { d.error(e); }
  };
  const setting = p => S2.settings.find(x => x.path === p);
  const change = async (values, msg) => {
    try { await auth.call('/api/settings', { values }); app?.toast?.(msg, 'good'); await load(); }
    catch (e) { if (e.code !== 'reauth_required') d.error(e); }
  };
  const sel = (cls, s, fmt = x => x) => `<select class="input ${cls}">${s.values.map(x => `<option value="${x}"${x === s.value ? ' selected' : ''}>${fmt(x)}</option>`).join('')}</select>`;
  function render() {
    const on = !!setting('mind.enabled')?.value, keep = setting('mind.keepDays'), k = O.today.byKind || {}, sp = O.speech || { on: false, shown: 0, blocked: 0, local: 0, unchecked: 0 };
    const n = (kind, st) => (k[kind]?.[st]?.n || 0);
    body.innerHTML = `<div class="aform mindadm">
      <div class="tier-head">💡 The Mind</div>
      <p class="hint">Agents whose brain is a model provider plan their day when they wake, reflect on it at bedtime and answer their chats. Agents without a brain of their own can still reflect each night with the world's brain. A thought never holds up the world: if one fails, the routine and Free Will go on.</p>
      <p><span class="tag${on ? ' set' : ''}">${on ? 'On' : 'Off'}</span> <span class="tag">${O.inFlight} thinking now</span>${O.paused.length ? ` <span class="tag warn">${O.paused.length} brain paused</span>` : ''}</p>
      <div class="row wrap"><button type="button" class="btn small${on ? '' : ' primary'} mind-a-switch">${on ? 'Switch the Mind off for everyone' : 'Switch the Mind on'}</button></div>
      <label>The world's brain (nightly reflections of agents without their own) <span class="row"><select class="input mind-a-brain"><option value="">None</option>
        ${O.brains.map(x => `<option value="${x.id}"${O.reflectConnection === x.id ? ' selected' : ''}${x.enabled && x.implemented ? '' : ' disabled'}>${esc(x.label)} (${esc(x.model || x.provider)})${x.status && x.status.ok === false ? ' — last test failed' : ''}</option>`).join('')}</select></span></label>
      <p class="hint">${O.brains.length ? 'Add or test brains in Settings → Connections (a Model provider, installation-wide).' : 'No brain yet: add a Model provider in Settings → Connections (installation-wide), for example OpenRouter with deepseek/deepseek-v4.1-flash.'}</p>
      <label>Most thoughts a day, one agent <span class="row">${sel('mind-a-jobs', setting('mind.agentDailyJobs'))}</span></label>
      <label>Most a month, one agent <span class="row">${sel('mind-a-month', setting('mind.agentMonthlyUsd'), x => `$${x}`)}</span></label>
      <label>Most a day, all agents <span class="row">${sel('mind-a-day', setting('mind.dailyUsd'), x => `$${x}`)}</span></label>
      <label>Keep the record of thoughts <span class="row"><select class="input mind-a-keep">${(keep.choices || [7, 30, 90, 365]).map(x => `<option value="${x}"${x === keep.value ? ' selected' : ''}>${x} days</option>`).join('')}</select></span></label>
      <div class="tier-head">🗣️ Speaking in public</div>
      <p class="hint">Agents with a brain of their own answer people who talk to them, and say something when they chat with someone, in their own words — in a speech bubble everyone near them sees. Every line is checked first: by the world's own rules (short, no links or contact details) and then by a moderation service. Without one, they only say the routine's lines.</p>
      <p><span class="tag${sp.on ? ' set' : ''}">${sp.on ? 'On' : 'Off'}</span> ${sp.moderator ? `<span class="tag set">Checked by ${esc(sp.moderator.label)}</span>` : '<span class="tag warn">No moderation service: nothing is said</span>'} <span class="tag">${sp.shown} said · ${sp.blocked} stopped · ${sp.local + sp.unchecked} not said</span></p>
      <div class="row wrap"><button type="button" class="btn small mind-a-speech">${sp.on ? 'Switch public speech off' : 'Switch public speech on'}</button></div>
      <label>The moderation service <span class="row"><select class="input mind-a-mod"><option value="">None (agents say only the routine's lines)</option>
        ${O.brains.filter(x => x.provider === 'openai' || x.provider === 'custom').map(x => `<option value="${x.id}"${sp.moderationConnection === x.id ? ' selected' : ''}${x.enabled && x.implemented ? '' : ' disabled'}>${esc(x.label)} (${esc(x.provider === 'openai' ? 'OpenAI' : 'OpenAI-compatible')})</option>`).join('')}</select></span></label>
      <p class="hint">An installation-wide Model provider with an OpenAI key (Settings → Connections) — OpenAI's moderation is free.</p>
      <label>Most lines one agent says in a world day <span class="row">${sel('mind-a-lines', setting('mind.speechPerDay'))}</span></label>
      <div class="tier-head">Today (UTC)</div>
      <div class="kv"><span class="k">Plans</span><span>${n('plan', 'ok')}${n('plan', 'failed') ? ` · ${n('plan', 'failed')} failed` : ''}</span>
        <span class="k">Reflections</span><span>${n('reflect', 'ok')}${n('reflect', 'failed') ? ` · ${n('reflect', 'failed')} failed` : ''}${n('reflect', 'skipped') ? ` · ${n('reflect', 'skipped')} skipped` : ''}</span>
        <span class="k">Chats</span><span>${n('chat', 'ok')}${n('chat', 'failed') ? ` · ${n('chat', 'failed')} failed` : ''}</span>
        <span class="k">Problems</span><span>${n('problem', 'ok')} thought about${O.problems ? ` · ${O.problems.open} open now` : ''}</span>
        <span class="k">Cost</span><span>${usd(O.today.cost)} of ${usd(O.today.limitMicro)}</span>
        <span class="k">Speed</span><span>${O.latency ? `${(O.latency.p50 / 1000).toFixed(1)} s typical, ${(O.latency.p95 / 1000).toFixed(1)} s slowest 5%` : '—'}</span></div>
      <div class="row"><button type="button" class="btn small mind-a-refresh">Refresh</button></div></div>`;
    const q = s => body.querySelector(s);
    q('.mind-a-switch').onclick = () => change({ 'mind.enabled': !on }, on ? 'The Mind is off' : 'The Mind is on');
    q('.mind-a-brain').onchange = e => change({ 'mind.reflectConnection': e.target.value || null }, 'The world\'s brain saved');
    q('.mind-a-jobs').onchange = e => change({ 'mind.agentDailyJobs': e.target.value }, 'Limit saved');
    q('.mind-a-month').onchange = e => change({ 'mind.agentMonthlyUsd': e.target.value }, 'Limit saved');
    q('.mind-a-day').onchange = e => change({ 'mind.dailyUsd': e.target.value }, 'Limit saved');
    q('.mind-a-keep').onchange = e => change({ 'mind.keepDays': Number(e.target.value) }, 'Retention saved');
    q('.mind-a-speech').onclick = () => change({ 'mind.speech': !sp.on }, sp.on ? 'Agents say only the routine\'s lines now' : 'Agents speak in their own words (checked first)');
    q('.mind-a-mod').onchange = e => change({ 'mind.moderationConnection': e.target.value || null }, 'Moderation service saved');
    q('.mind-a-lines').onchange = e => change({ 'mind.speechPerDay': e.target.value }, 'Limit saved');
    q('.mind-a-refresh').onclick = load;
  }
  body.innerHTML = '<p class="hint">Loading…</p>';
  await load();
}
export function useMindAdmin(a) { app = a || app; }
