// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Free Will in the UI (docs/features/FREE-WILL.md §9).
// - An agent's Free Will (the switch, spontaneity, its decision service, today's numbers and "Why it chose") is the
//   Agent Studio's Free Will tab (ui/studio-mind.js); the words and the why-list rows it shows are here.
// - Settings → Free Will (freewill.admin): the installation's switch, its decision service, the daily limits, and the
//   service at a glance (requests and cost today, speed, why the routine chose, paused services).
import { auth } from '../core/auth.js';
import { getJSON } from '../core/net.js';
import { esc } from '../core/util.js';

let app = null;
export function init(a) { app = a; }

export const STATUS = {
  active: 'On - it decides for itself: free time, meals, mornings, the way to work, rest and how to work on tasks. Only sleep is left to its routine.',
  switched_off: 'Off - it follows its routine.',
  starting: 'Starting…',
  off: 'Free Will is switched off for the whole world by an administrator.',
  no_service: 'No decision service is set up yet: an administrator chooses one in Settings → Free Will.',
  service_unavailable: 'Its decision service is not available on this server.',
  not_allowed: 'Its owner may not use the chosen decision service.',
  no_body: 'It has no body in the world right now.',
  agent_off: 'The agent is switched off.',
  no_owner: 'Its owner\'s account is not active.',
};
export const WHY = {
  late: 'the answer came too late', situation_changed: 'the situation changed before it could act', timeout: 'the decision service took too long', refused: 'the decision service declined to answer',
  invalid_answer: 'the answer was not one of the options', not_possible: 'its pick was no longer possible', could_not_do: 'its pick could not be carried out',
  service_paused: 'the decision service is paused after failures', daily_limit: 'the world\'s daily limit was reached', agent_daily_limit: 'its daily limit was reached',
  busy: 'too many decisions at once', order: 'its own AI gave it something to do', resume: 'it went back to what a message interrupted', no_time: 'there was no time to ask', off: 'Free Will was off', error: 'something went wrong preparing it', plan_changed: 'its plans changed',
};
export const CHOICE = { leisure: 'Free time', task: 'Task', meal: 'Meal', morning: 'Morning', shift: 'Way to work', rest: 'Rest', after_task: 'After a task' };
export const why = r => WHY[r] || (String(r || '').startsWith('service_') ? 'the decision service failed' : 'routine');
export const usd = micro => (micro >= 10000 ? `$${(micro / 1e6).toFixed(2)}` : `$${(micro / 1e6).toFixed(4)}`);
const pct = p => `${Math.round(p * 100)}%`;

export function spontWord(s) { return s <= 0.15 ? 'Predictable' : s <= 0.4 ? 'Steady' : s <= 0.65 ? 'Balanced' : s <= 0.85 ? 'Adventurous' : 'Impulsive'; }

/** One line of "Why it chose": the choice, the options it had and how likely each was - or why its routine chose. */
export function row(r) {
  const head = `<span class="tag fw-kind">${esc(CHOICE[r.choice] || 'Free time')}</span> <span class="fw-when">${esc(r.when || '')}</span>${r.place ? ` <span class="dim">· ${esc(r.place)}</span>` : ''}`;
  if (r.outcome === 'chosen') {
    const opts = [...(r.probs || [])].sort((a, b) => b.p - a.p).slice(0, 4);
    const label = id => (r.options.find(o => o.id === id)?.label || id);
    return `<li class="fw-item chosen"><div>${head}</div><div class="fw-pick">✓ ${esc(r.label || label(r.chosen))}${r.reason === 'next_best' ? ' <small class="dim">(its first pick was no longer possible)</small>' : ''}</div>
      <div class="fw-opts">${opts.map(o => `<div class="fw-opt${o.id === r.chosen ? ' on' : ''}"><span class="fw-bar" style="width:${Math.max(3, Math.round(o.p * 100))}%"></span><span class="fw-ol">${esc(label(o.id))}</span><span class="fw-op">${pct(o.p)}</span></div>`).join('')}</div></li>`;
  }
  return `<li class="fw-item routine"><div>${head}</div><div class="dim">Followed its routine - ${esc(why(r.reason))}${r.label ? ` (it had picked ${esc(r.label)})` : ''}</div></li>`;
}

// ------------------------------------------------------------------ Settings → Free Will (administrators)
export async function freeWillAdminTab(d, body) {
  let O = null, S2 = null;
  const load = async () => {
    try {
      [O, S2] = await Promise.all([getJSON('/api/free-will/overview'), getJSON('/api/settings')]);
      render();
    } catch (e) { d.error(e); }
  };
  const setting = p => S2.settings.find(x => x.path === p);
  const change = async (values, msg) => {
    try { await auth.call('/api/settings', { values }); app?.toast?.(msg, 'good'); await load(); }
    catch (e) { if (e.code !== 'reauth_required') d.error(e); }
  };
  function render() {
    const on = !!setting('freeWill.enabled')?.value, def = O.defaultConnection;
    const lim = setting('freeWill.dailyDecisions'), alim = setting('freeWill.agentDailyDecisions'), keep = setting('freeWill.keepDays');
    const reasons = Object.entries(O.reasons || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
    body.innerHTML = `<div class="aform fwadm">
      <div class="tier-head">🧠 Free Will</div>
      <p class="hint">Agents whose owners switch Free Will on let a decision service choose what they do with their free time. The world never waits for an answer: when one is late or something fails, the agent follows its routine.</p>
      <p><span class="tag${on ? ' set' : ''}">${on ? 'On' : 'Off'}</span> <span class="tag">${O.activeAgents} agents using it</span> <span class="tag">${O.inFlight} in flight</span>
        ${O.paused.length ? `<span class="tag warn">${O.paused.length} service paused</span>` : ''}</p>
      <div class="row wrap"><button type="button" class="btn small${on ? '' : ' primary'} fw-a-switch">${on ? 'Switch Free Will off for everyone' : 'Switch Free Will on'}</button></div>
      <label>Decision service <span class="row"><select class="input fw-a-svc"><option value="">None</option>
        ${O.services.map(x => `<option value="${x.id}"${def === x.id ? ' selected' : ''}${x.enabled && x.implemented ? '' : ' disabled'}>${esc(x.label)} (${esc(x.kind)})${x.status && x.status.ok === false ? ' - last test failed' : ''}</option>`).join('')}</select></span></label>
      <p class="hint">${O.services.length ? 'Add or test decision services in Settings → Connections (an installation-wide connection, shared with the roles that may use it).' : 'No decision service yet: add one in Settings → Connections (for example OpenAI Decisions), shared with the roles that may use it.'}</p>
      <label>Most decisions a day, all agents <span class="row"><select class="input fw-a-lim">${lim.values.map(x => `<option${x === lim.value ? ' selected' : ''}>${x}</option>`).join('')}</select></span></label>
      <label>Most decisions a day, one agent <span class="row"><select class="input fw-a-alim">${alim.values.map(x => `<option${x === alim.value ? ' selected' : ''}>${x}</option>`).join('')}</select></span></label>
      <label>Keep the why-log <span class="row"><select class="input fw-a-keep">${(keep.choices || [1, 3, 7, 14, 30, 90]).map(x => `<option value="${x}"${x === keep.value ? ' selected' : ''}>${x} day${x === 1 ? '' : 's'}</option>`).join('')}</select></span></label>
      <div class="tier-head">Today (UTC)</div>
      <div class="kv"><span class="k">Asked</span><span>${O.today.requests} of ${O.today.limit}</span><span class="k">Cost</span><span>${usd(O.today.costMicro)}</span>
        <span class="k">Speed</span><span>${O.latencyMs.p50 === null ? '-' : `${O.latencyMs.p50} ms typical, ${O.latencyMs.p95} ms slowest 5%`}</span>
        <span class="k">Since start</span><span>${O.counts.chosen} chosen · ${O.counts.routine} by routine · ${O.counts.skippedRoutine} routine moments not asked</span></div>
      ${reasons.length ? `<p class="hint">Why the routine chose: ${reasons.map(([k, n]) => `${esc(why(k))} ${n}`).join(' · ')}</p>` : ''}
      <div class="row"><button type="button" class="btn small fw-a-refresh">Refresh</button></div></div>`;
    const q = s => body.querySelector(s);
    q('.fw-a-switch').onclick = () => change({ 'freeWill.enabled': !on }, on ? 'Free Will is off' : 'Free Will is on');
    q('.fw-a-svc').onchange = e => change({ 'freeWill.defaultConnection': e.target.value || null }, 'Decision service saved');
    q('.fw-a-lim').onchange = e => change({ 'freeWill.dailyDecisions': e.target.value }, 'Daily limit saved');
    q('.fw-a-alim').onchange = e => change({ 'freeWill.agentDailyDecisions': e.target.value }, 'Daily limit saved');
    q('.fw-a-keep').onchange = e => change({ 'freeWill.keepDays': Number(e.target.value) }, 'Why-log retention saved');
    q('.fw-a-refresh').onclick = load;
  }
  body.innerHTML = '<p class="hint">Loading…</p>';
  await load();
}
export function useFreeWillAdmin(a) { app = a || app; }
